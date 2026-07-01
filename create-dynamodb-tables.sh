#!/bin/bash

# Define the region where you want to create the tables
REGION="ap-south-1" # Change this as needed

# List of collections/tables needed
TABLES=(
  "appConfig"
  "appUsers"
  "paymentLinks"
  "subscriptionPlans"
  "subscriptionHistory"
  "feeTemplates"
  "admins"
  "playerStats"
  "posts"
  "notifications"
  "grounds"
  "players"
  "matches"
  "outOfPlays"
  "otherFees"
  "payments"
  "comments"
)

echo "Starting DynamoDB table creation in region: $REGION"

for TABLE in "${TABLES[@]}"; do
  echo "Creating table: $TABLE..."
  aws dynamodb create-table \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=_id,AttributeType=S \
    --key-schema AttributeName=_id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" > /dev/null 2>&1
  
  if [ $? -eq 0 ]; then
    echo "✅ Table '$TABLE' created successfully."
  else
    echo "⚠️  Table '$TABLE' may already exist or there was an error."
  fi
done

echo ""
echo "All tables requested. You can verify them in your AWS Console."
