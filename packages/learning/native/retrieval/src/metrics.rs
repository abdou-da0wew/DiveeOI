//! Retrieval quality metrics for the offline teacher-vs-student benchmark.
//!
//! Relevance is binary: a result is relevant when its chunk id is in the judged set.

use std::collections::HashSet;

/// Fraction of the relevant set found in the top `k` results (0 when nothing is relevant).
pub fn recall_at(ranked: &[String], relevant: &HashSet<String>, k: usize) -> f64 {
    if relevant.is_empty() {
        return 0.0;
    }
    let found = ranked
        .iter()
        .take(k)
        .filter(|id| relevant.contains(*id))
        .count();
    found as f64 / relevant.len() as f64
}

/// 1 / rank of the first relevant result within the top `k`, else 0.
pub fn reciprocal_rank_at(ranked: &[String], relevant: &HashSet<String>, k: usize) -> f64 {
    ranked
        .iter()
        .take(k)
        .position(|id| relevant.contains(id))
        .map_or(0.0, |index| 1.0 / (index as f64 + 1.0))
}

/// Binary-relevance nDCG@k with the ideal ranking limited to `min(k, |relevant|)` hits.
pub fn ndcg_at(ranked: &[String], relevant: &HashSet<String>, k: usize) -> f64 {
    if relevant.is_empty() {
        return 0.0;
    }
    let gain = |index: usize| 1.0 / ((index as f64) + 2.0).log2();
    let dcg: f64 = ranked
        .iter()
        .take(k)
        .enumerate()
        .filter(|(_, id)| relevant.contains(*id))
        .map(|(index, _)| gain(index))
        .sum();
    let ideal: f64 = (0..relevant.len().min(k)).map(gain).sum();
    if ideal == 0.0 { 0.0 } else { dcg / ideal }
}

/// Nearest-rank percentile (`p` in 0..=100) of an unsorted sample; 0 for an empty sample.
pub fn percentile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let rank = ((p / 100.0) * sorted.len() as f64).ceil().max(1.0) as usize;
    sorted[rank.min(sorted.len()) - 1]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn set(values: &[&str]) -> HashSet<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn recall_counts_relevant_found_in_top_k() {
        let ranked = ids(&["a", "b", "c", "d"]);
        let relevant = set(&["b", "d", "x"]);
        assert!((recall_at(&ranked, &relevant, 2) - 1.0 / 3.0).abs() < 1e-12);
        assert!((recall_at(&ranked, &relevant, 4) - 2.0 / 3.0).abs() < 1e-12);
        assert_eq!(recall_at(&ranked, &set(&[]), 4), 0.0);
    }

    #[test]
    fn reciprocal_rank_uses_first_relevant_within_k() {
        let ranked = ids(&["a", "b", "c"]);
        assert_eq!(reciprocal_rank_at(&ranked, &set(&["b"]), 10), 0.5);
        assert_eq!(reciprocal_rank_at(&ranked, &set(&["c"]), 2), 0.0);
        assert_eq!(reciprocal_rank_at(&ranked, &set(&["a"]), 10), 1.0);
    }

    #[test]
    fn ndcg_is_one_for_ideal_order_and_lower_otherwise() {
        let relevant = set(&["a", "b"]);
        assert!((ndcg_at(&ids(&["a", "b", "c"]), &relevant, 10) - 1.0).abs() < 1e-12);
        let worse = ndcg_at(&ids(&["c", "a", "b"]), &relevant, 10);
        assert!(worse > 0.0 && worse < 1.0);
        assert_eq!(ndcg_at(&ids(&["c", "d"]), &relevant, 10), 0.0);
    }

    #[test]
    fn percentile_uses_nearest_rank() {
        let sample = [10.0, 20.0, 30.0, 40.0, 50.0];
        assert_eq!(percentile(&sample, 50.0), 30.0);
        assert_eq!(percentile(&sample, 95.0), 50.0);
        assert_eq!(percentile(&[], 95.0), 0.0);
    }
}
