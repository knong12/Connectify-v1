# Matching and Explanations

## Why the Score Changed

The original algorithm added fixed points for each same-window artist or track overlap, with an eight-point minimum and a 100-point cap. Increasing the sample to 50 items per window made it easy to hit the cap, hiding differences between profiles. An empty or disjoint profile could also display an apparently positive score.

Version `jaccard-v2` replaces that sum with normalized list similarity. It uses the music already stored in PostgreSQL; matching makes no additional Spotify requests and uses no genres, audio analysis, play counts, profile text, or machine-learning model.

## Formula

For each of three time windows and each music type:

```text
shared = count of Spotify IDs appearing in both lists
union = your distinct IDs + their distinct IDs - shared
similarity = shared / union
base weight = music-type weight * time-window weight

active weight = sum of base weights where union > 0
effective maximum points = base weight / active weight * 100
signal contribution = similarity * effective maximum points
score = sum of contributions, rounded to one decimal place
```

| Signal | Recent | 6 Months | 1 Year | Total Base Weight |
| --- | ---: | ---: | ---: | ---: |
| Artists | 30% | 18% | 12% | 60% |
| Tracks | 20% | 12% | 8% | 40% |

The overlap definition is the standard Jaccard coefficient described in [Introduction to Information Retrieval](https://nlp.stanford.edu/IR-book/html/htmledition/irbook.html). The artist/track split and recency weights are Connectify design choices, not research-validated compatibility weights.

## Worked Examples

If only recent lists are present:

- Your artists are A and B; theirs are A and C. One shared artist divided by three combined distinct artists gives 1/3 artist similarity.
- You both have track X. Track similarity is 1/1.
- The recent artist and track weights rescale from 30:20 to 60:40 because the other windows are empty for both.
- Artist contribution is 20 points; track contribution is 40 points. The total is 60/100.

For two 50-artist lists sharing 25 artists, union size is 75, not 50. Artist similarity is therefore 25/75 = 33.3%, not 50%. Simply syncing more artists does not automatically push the score to 100.

## Missing and Sparse Data

- When both lists for a signal are empty, it has no weight; that absence is not treated as perfect similarity.
- When just one list is empty, its similarity is zero and it retains its weight.
- When either person has no music anywhere, the API marks the comparison `insufficient_data`; the UI explains that both profiles need synced listening data rather than implying there is no musical overlap.
- A comparison is labeled limited when either profile has fewer than 10 unique artists plus tracks, or any of the six signal pairs has an empty list on either side. This is a coverage warning, not a statistical confidence estimate.
- Identical single-item profiles can receive 100 on the available data. The visible limited-data warning is important: this is not equivalent evidence to identical full profiles.
- Profiles synced before the 50-item change can still contain smaller samples. The size difference affects Jaccard scores; re-syncing profiles improves comparability.

## Explanation Contract

The backend returns the formula version, comparison status, data-coverage flag, per-person unique item counts, and six signal records. Each signal includes both list sizes, shared and union counts, similarity, effective maximum points, and its contribution.

Shared-music evidence includes Spotify ID, name, image, and same-window rank pairs. Items shared only across different windows are retained as context and labeled as appearing at different listening windows. Each Spotify ID appears once in an evidence list; duplicate input rows cannot inflate a signal. Ranks explain position in the synced top lists, not listening counts or additional scoring weight.

The frontend focuses on shared artist/track counts, named favorites, artwork, Spotify links, and expandable evidence. Numerical comparison scores, contribution meters, and formula breakdowns are not displayed. The backend retains scores and signals in its response for ranking and technical inspection; hiding them in the UI does not make them secret. Summaries use actual shared music rather than fabricated explanations from profile text.

## Ordering and Actions

Scored profiles come before comparisons without sufficient data. Results then sort by unrounded score descending, unique shared artist count, unique shared track count, and user ID for deterministic exact ties. Scores are used internally for ordering, not shown as compatibility ratings. Shared counts include different-window contextual matches, which only influence tie-breaking, not the numeric score.

Cards form a horizontally scrolling row with previous/next buttons, touch scrolling, keyboard arrows when the row is focused, and reduced-motion support. The controls disable at the row boundaries. Matching remains available for zero-overlap profiles; the UI says no shared favorites were found in the synced lists rather than calling them strong recommendations. Follow/unfollow updates are scoped to each card, and a failed action leaves other cards available. Profile and joint-mix links remain on each card.

## Evaluation and Limitations

The score measures similarity of Spotify top-item samples, not friendship potential, musical quality, or a verified likelihood of liking someone's recommendations. Spotify time windows overlap and are not independent observations. The method does not distinguish mainstream from niche matches, and ranks do not affect numeric similarity. Missing data may reflect synchronization or access limitations rather than genuine differences in taste.

Next evaluation steps: compare user-rated similarity against score ordering; test alternative weights; compare Jaccard with other similarity measures on the same consented datasets; and examine whether sparse profiles need a minimum sample threshold before receiving any score.

## Verification

From the repository root:

```powershell
node --import tsx --test apps/api/tests/matchScoring.test.ts apps/api/tests/spotifyAuth.test.ts
```

The scoring tests exercise identical and disjoint sets, empty profiles, partial overlap, unequal list sizes, recency weights, duplicate IDs, missing signals, different-window matches, rank invariance, deterministic ranking, and seeded symmetry/bounds/contribution checks. No test requires writing users or music to the database.
