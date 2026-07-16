#!/usr/bin/env bash
# Downloads AMB spec example files from the official dini-ag-kim/amb repository.
# Run this script to update test fixtures when the AMB spec changes.

set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/dini-ag-kim/amb/master/draft/examples"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../tests/data/amb-spec"

VALID_FILES=(
  MIT-License.json
  about-with-other-vocabulary.json
  about.json
  addingToContext.json
  additionalContext.json
  affiliation.json
  affiliationOhneId.json
  competencies.json
  conceptsAsObjectWithUriOnly.json
  conceptsWithMultilingualLabels.json
  contributor.json
  dateTime.json
  educationalLevel.json
  funder.json
  h5p-media-type.json
  highered-course-part.json
  highered-course.json
  highered-figure.json
  interactivityType.json
  isAccessibleForFree.json
  isBasedOn.json
  isBasedOn_idOnly.json
  isBasedOn_nameOnly.json
  learningResourceType-with-other-vocabulary.json
  learningResourceType.json
  mainEntityOf.json
  oerInMultipleLanguages.json
  parts.json
  schemaorg-context.json
  suggested-min-age.json
  trailer.json
  trailerAudio.json
  tutoryExample.json
  typeWithLearningResourceAsSecondItem.json
  videoWithEncodings.json
  videoWithoutContentUrl.json
)

INVALID_FILES=(
  Mozilla-Public-License.json
  about.json
  affiliationWithoutName.json
  assessesWithoutURI.json
  captionInMultipleLanguages.json
  captionWithoutArray.json
  competencyRequiredAsObject.json
  conceptWithMonolingualLabels.json
  conditionsOfAccessStringInsteadObject.json
  contentSizeAndBitRateWithUnits.json
  educationalLevelWithWrongID.json
  funderInvalidType.json
  inLanguageWithoutArray.json
  interactivityType.json
  invalidAboutConceptUri.json
  isAccessibleForFree.json
  isBasedOn_noArray.json
  isBasedOn_noIdOrName.json
  keywordWithoutArray.json
  learningResourceType-wihtout-any-valid-id.json
  license-as-string.json
  lrtWithoutArray.json
  mainEntityOf.json
  mainEntityOfPageInvalidType.json
  missingDefaultLanguage.json
  missingDefaultLanguage2.json
  noContext.json
  partWithoutId.json
  suggestedAge-as-string.json
  teachesWithoutLocalizedPrefLabel.json
  typeAsURI.json
  typeWithoutArray.json
  typeWithoutLearningResource.json
  videoWithoutUrls.json
  wrongContextLink.json
  wrongDateTime.json
  wrongDefaultLanguageTag.json
  wrongDuration.json
)

echo "Downloading valid examples..."
mkdir -p "$DATA_DIR/valid"
for f in "${VALID_FILES[@]}"; do
  curl -sf "$BASE_URL/valid/$f" -o "$DATA_DIR/valid/$f"
  echo "  ✓ $f"
done

echo "Downloading invalid examples..."
mkdir -p "$DATA_DIR/invalid"
for f in "${INVALID_FILES[@]}"; do
  curl -sf "$BASE_URL/invalid/$f" -o "$DATA_DIR/invalid/$f"
  echo "  ✓ $f"
done

echo "Done. Downloaded ${#VALID_FILES[@]} valid and ${#INVALID_FILES[@]} invalid examples."
