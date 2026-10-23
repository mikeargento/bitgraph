#!/usr/bin/env bash
#
# OCC Ledger — Create S3 bucket with Object Lock
#
# Run this on the EC2 instance (or anywhere with AWS creds).
# Requires: aws cli v2
#
# Usage:
#   ./setup-bucket.sh                    # uses defaults
#   BUCKET=my-bucket REGION=us-west-2 ./setup-bucket.sh

set -euo pipefail

BUCKET="${BUCKET:-occ-ledger-prod}"
REGION="${REGION:-us-east-2}"

echo "[setup] Creating S3 bucket: ${BUCKET} in ${REGION}"

# Create bucket with Object Lock enabled (must be set at creation time)
aws s3api create-bucket \
  --bucket "${BUCKET}" \
  --region "${REGION}" \
  --create-bucket-configuration LocationConstraint="${REGION}" \
  --object-lock-enabled-for-bucket

echo "[setup] Bucket created with Object Lock enabled"

# Set default Object Lock configuration: COMPLIANCE mode, 10 years
aws s3api put-object-lock-configuration \
  --bucket "${BUCKET}" \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {
      "DefaultRetention": {
        "Mode": "COMPLIANCE",
        "Days": 3650
      }
    }
  }'

echo "[setup] Default retention set: COMPLIANCE mode, 3650 days (10 years)"

# Enable versioning (required for Object Lock)
aws s3api put-bucket-versioning \
  --bucket "${BUCKET}" \
  --versioning-configuration Status=Enabled

echo "[setup] Versioning enabled"

# Block public access
aws s3api put-public-access-block \
  --bucket "${BUCKET}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "[setup] Public access blocked"

echo ""
echo "=== S3 Bucket Ready ==="
echo "Bucket: ${BUCKET}"
echo "Region: ${REGION}"
echo ""
echo "Set these environment variables on your services:"
echo "  LEDGER_BUCKET=${BUCKET}"
echo "  LEDGER_REGION=${REGION}"
echo ""
echo "IAM policy needed for EC2 role and Railway service:"
cat <<'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OCCLedgerWrite",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectRetention",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::occ-ledger-prod",
        "arn:aws:s3:::occ-ledger-prod/*"
      ]
    }
  ]
}
POLICY
