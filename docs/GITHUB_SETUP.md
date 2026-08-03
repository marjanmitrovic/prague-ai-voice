# GitHub setup

## 1. Create repository

Suggested repository name:

```text
prague-ai-voice
```

Keep it public only if you are comfortable showing the demo source. The project does not include real API keys, but it is still a prototype.

## 2. First commit

From the project folder:

```powershell
git init
git add .
git commit -m "Initial Prague AI Voice demo"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/prague-ai-voice.git
git push -u origin main
```

## 3. Never commit secrets

Do not commit `.env`, generated logs, `node_modules`, audio files, or local temporary test data.

Already ignored:

```text
.env
node_modules/
dist/
logs/
coverage/
*.log
```

## 4. Local verification before pushing

```powershell
npm install
npm test
npm run build
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```
