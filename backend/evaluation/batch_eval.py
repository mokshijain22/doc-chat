"""
backend/evaluation/batch_eval.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Batch evaluation runner.

Usage:
    cd backend
    python -m evaluation.batch_eval --dataset evaluation/eval_dataset.json --out evaluation/results.json

What it does:
    1. Loads eval_dataset.json
    2. Runs each query through the full RAGPipeline
       (real retrieval + rewriting + reranking + generation)
    3. Evaluates each result with RAGEvaluator
    4. Writes per-sample + aggregate results to results.json
    5. Prints a summary table

eval_dataset.json format (see SAMPLE_DATASET below for exact schema):
    [
      {
        "query": "What are the main findings?",
        "reference_answer": "The study found that...",
        "relevant_chunk_ids": ["report.pdf:3:1", "report.pdf:5:0"]
      },
      ...
    ]

relevant_chunk_ids:
    Format: "filename:page_number:chunk_index"
    How to find them: run a query, look at the chunks returned, note their
    doc_name, page_number, chunk_index. Mark which ones actually answer the query.

You need ~10-20 samples for a meaningful eval. Start with 5 to validate the pipeline.
"""

import argparse
import json
import sys
import time
import os
from pathlib import Path

# Allow running from backend/ directory
# Find backend/ regardless of where the script is called from
sys.path.insert(0, str(Path(__file__).parent.parent))  # this already exists — verify it's there
from openai import OpenAI
from dotenv import load_dotenv
from rag_retrieval import RAGPipeline
from evaluation.evaluator import RAGEvaluator, EvalSample, EvalResult

load_dotenv()


# ── Sample eval dataset (copy to evaluation/eval_dataset.json and fill in) ──
SAMPLE_DATASET = [
    {
        "query": "What are the main findings of the study?",
        "reference_answer": "Replace this with the actual expected answer from your PDF.",
        "relevant_chunk_ids": [
            "your_document.pdf:3:1",
            "your_document.pdf:3:2"
        ]
    },
    {
        "query": "What methodology was used?",
        "reference_answer": "Replace this with the actual expected answer.",
        "relevant_chunk_ids": [
            "your_document.pdf:2:0"
        ]
    }
]


def load_dataset(path: str) -> list[EvalSample]:
    with open(path, "r") as f:
        raw = json.load(f)
    samples = []
    for item in raw:
        samples.append(EvalSample(
            query              = item["query"],
            reference_answer   = item.get("reference_answer", ""),
            relevant_chunk_ids = item.get("relevant_chunk_ids", []),
        ))
    return samples


def run_batch_eval(
    dataset_path: str,
    pdf_paths:    list[str],
    output_path:  str,
) -> dict:
    """
    Full batch eval:
      1. Ingest all PDFs
      2. For each sample: retrieve → rerank → generate → evaluate
      3. Save results
    """
    client    = OpenAI(api_key=os.environ["GROQ_API_KEY"], base_url="https://api.groq.com/openai/v1")
    pipeline  = RAGPipeline()
    evaluator = RAGEvaluator(client)

    # Ingest PDFs
    print(f"\nIngesting {len(pdf_paths)} PDF(s)...")
    for path in pdf_paths:
        n = pipeline.ingest(path)
        print(f"   {os.path.basename(path)}: {n} chunks")

    # Load eval samples
    samples = load_dataset(dataset_path)
    print(f"\nRunning eval on {len(samples)} samples...\n")

    results:        list[EvalResult] = []
    per_sample_log: list[dict]       = []

    for i, sample in enumerate(samples, 1):
        print(f"  [{i}/{len(samples)}] {sample.query[:60]}...")
        t0 = time.time()

        # Run full pipeline (with query rewriting + reranking if enabled)
        pipeline_result = pipeline.query(
            question = sample.query,
            strict   = False,    # eval mode: always try to answer
            eli5     = False,
        )

        elapsed = round((time.time() - t0) * 1000)

        # Evaluate
        eval_result = evaluator.evaluate_sample(
            sample            = sample,
            retrieved_chunks  = pipeline_result.chunks,
            generated_answer  = pipeline_result.answer,
        )
        results.append(eval_result)

        # Log full detail
        per_sample_log.append({
            "query":             sample.query,
            "reference_answer":  sample.reference_answer,
            "generated_answer":  pipeline_result.answer,
            "retrieved_ids":     [f"{c.doc_name}:{c.page_number}:{c.chunk_index}" for c in pipeline_result.chunks],
            "relevant_ids":      sample.relevant_chunk_ids,
            "precision_at_k":    eval_result.precision_at_k,
            "recall_at_k":       eval_result.recall_at_k,
            "mrr":               eval_result.mrr,
            "faithfulness":      eval_result.faithfulness,
            "answer_relevance":  eval_result.answer_relevance,
            "correctness":       eval_result.correctness,
            "rationale":         eval_result.rationale,
            "latency_ms":        elapsed,
        })

        print(f"     P@K={eval_result.precision_at_k:.2f}  R@K={eval_result.recall_at_k:.2f}  "
              f"MRR={eval_result.mrr:.2f}  Faith={eval_result.faithfulness:.2f}  "
              f"Corr={eval_result.correctness:.2f}  ({elapsed}ms)")

    # Aggregate
    agg = evaluator.aggregate(results)

    output = {"aggregate": agg, "samples": per_sample_log}
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    # Print summary
    print(f"\n{'='*60}")
    print(f"EVALUATION SUMMARY ({len(results)} samples)")
    print(f"{'='*60}")
    print(f"  Precision@K:       {agg['avg_precision_at_k']:.4f}  ({agg['avg_precision_at_k']*100:.1f}%)")
    print(f"  Recall@K:          {agg['avg_recall_at_k']:.4f}  ({agg['avg_recall_at_k']*100:.1f}%)")
    print(f"  MRR:               {agg['avg_mrr']:.4f}")
    print(f"  Faithfulness:      {agg['avg_faithfulness']:.4f}  ({agg['avg_faithfulness']*100:.1f}%)")
    print(f"  Answer Relevance:  {agg['avg_answer_relevance']:.4f}  ({agg['avg_answer_relevance']*100:.1f}%)")
    print(f"  Correctness:       {agg['avg_correctness']:.4f}  ({agg['avg_correctness']*100:.1f}%)")
    print(f"\n  Full results: {output_path}")

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DocChat AI Batch Evaluator")
    parser.add_argument("--dataset", required=True, help="Path to eval_dataset.json")
    parser.add_argument("--pdfs",    required=True, nargs="+", help="PDF files to ingest for eval")
    parser.add_argument("--out",     default="evaluation/results.json", help="Output path")
    args = parser.parse_args()

    run_batch_eval(
        dataset_path = args.dataset,
        pdf_paths    = args.pdfs,
        output_path  = args.out,
    )
