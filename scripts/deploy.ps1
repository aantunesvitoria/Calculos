param(
  [string]$Branch = "main"
)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "Git não foi encontrado. Instale o Git e execute novamente."
  exit 1
}

Write-Host "Verificando o branch local..."
$branchName = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) {
  Write-Error "Não foi possível determinar o branch atual."
  exit $LASTEXITCODE
}

if ($branchName -ne $Branch) {
  Write-Host "Branch atual: $branchName"
  Write-Host "Mudando para o branch de deploy: $Branch"
  git checkout $Branch
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha ao trocar para o branch '$Branch'."
    exit $LASTEXITCODE
  }
}

Write-Host "Verificando alterações não commitadas..."
$status = git status --short
if ($status) {
  Write-Error "Há alterações não commitadas no repositório. Faça commit antes de executar o deploy."
  Write-Host $status
  exit 1
}

Write-Host "Enviando o branch '$Branch' para origin..."
git push origin $Branch
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha ao enviar para origin/$Branch."
  exit $LASTEXITCODE
}

Write-Host "Deploy acionado com sucesso."
Write-Host "GitHub Pages e Render devem iniciar o processo de deploy automático após o push."
Write-Host "Acompanhe o status no GitHub Actions e no painel do Render."
