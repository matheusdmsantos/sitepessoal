# Abre o PDF pedido pelo link estudopdf:abrir?arquivo=<nome.pdf>&pagina=<n>.
# Qualquer site pode chamar o link: só aceita um nome de arquivo .pdf (sem pasta nem curinga)
# e só procura nas pastas escolhidas no instalador.
param([string]$url = '')
Add-Type -AssemblyName System.Windows.Forms
function Aviso($t) { [System.Windows.Forms.MessageBox]::Show($t, 'Estudo PDF') | Out-Null; exit 1 }

$cfg = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$q = @{}
if ($url.Contains('?')) {
  foreach ($par in $url.Substring($url.IndexOf('?') + 1).Split('&')) {
    $kv = $par.Split('=', 2)
    if ($kv.Count -eq 2) { $q[$kv[0]] = [uri]::UnescapeDataString($kv[1].Replace('+', ' ')) }
  }
}
$arquivo = [string]$q['arquivo']
$pagina = 0
[void][int]::TryParse([string]$q['pagina'], [ref]$pagina)
if (-not $arquivo.ToLower().EndsWith('.pdf') -or $arquivo.IndexOfAny([char[]]'\/:*?"<>|') -ge 0) { Aviso "Nome de arquivo inválido: $arquivo" }

$achado = foreach ($p in $cfg.pastas) {
  Get-ChildItem -LiteralPath $p -Recurse -File -Filter $arquivo -ErrorAction SilentlyContinue
}
$achado = $achado | Where-Object { $_.Name -eq $arquivo } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $achado) { Aviso "Não achei `"$arquivo`" em:`n$($cfg.pastas -join "`n")`n`nConfira o nome do arquivo ou rode o instalador de novo para incluir a pasta." }

if ($cfg.foxit -and (Test-Path $cfg.foxit)) {
  $argumentos = @('"' + $achado.FullName + '"')
  if ($pagina -gt 0) { $argumentos += '/A', "page=$pagina" }
  Start-Process -FilePath $cfg.foxit -ArgumentList $argumentos
} else {
  Invoke-Item -LiteralPath $achado.FullName
}
