# Merge Staging to Main - Commands

```bash
# 1. Ensure you're on main branch and it's up to date
git checkout main
git pull origin main

# 2. Merge staging into main
git merge staging

# 3. Push to origin
git push origin main
```

That's it! The merge should be clean since staging was already tested.

