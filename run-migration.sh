#!/bin/bash
# Script to run the migration for split percentages

echo "Running migration to add split percentage fields..."

# Apply the migration
npx prisma migrate deploy

echo "Migration complete! The split percentage fields have been added to the database."

