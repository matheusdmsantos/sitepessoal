# Instala o link "estudopdf:" do Painel de Estudos (sem administrador: só HKCU).
# O "Ler agora" do site chama estudopdf:abrir?arquivo=<nome.pdf>&pagina=<n>; o abrir.ps1
# procura o arquivo nas pastas escolhidas aqui e abre no Foxit (ou no leitor padrão).
Add-Type -AssemblyName System.Windows.Forms
$destino = Join-Path $env:LOCALAPPDATA 'EstudoPDF'
New-Item -ItemType Directory -Force $destino | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'abrir.ps1') $destino -Force
Copy-Item (Join-Path $PSScriptRoot 'abrir.vbs') $destino -Force

# Pastas onde ficam os PDFs (subpastas entram na busca)
$pastas = @()
do {
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = 'Escolha a pasta onde ficam os PDFs de estudo (as subpastas também entram)'
  if ($dlg.ShowDialog() -ne 'OK') { break }
  $pastas += $dlg.SelectedPath
  $mais = [System.Windows.Forms.MessageBox]::Show("Pasta adicionada:`n$($dlg.SelectedPath)`n`nAdicionar outra pasta?", 'Estudo PDF', 'YesNo')
} while ($mais -eq 'Yes')
if (-not $pastas.Count) { Write-Host 'Nenhuma pasta escolhida. Nada foi instalado.'; exit 1 }

# Foxit: pelo registro (App Paths) ou nas pastas de instalação comuns
$foxit = $null
$nomes = 'FoxitPDFReader.exe', 'FoxitReader.exe', 'FoxitPDFEditor.exe', 'FoxitPhantomPDF.exe'
foreach ($n in $nomes) {
  foreach ($raiz in 'HKCU:\SOFTWARE', 'HKLM:\SOFTWARE', 'HKLM:\SOFTWARE\WOW6432Node') {
    $k = "$raiz\Microsoft\Windows\CurrentVersion\App Paths\$n"
    try { $v = (Get-ItemProperty $k -ErrorAction Stop).'(default)'; if ($v -and (Test-Path $v)) { $foxit = $v; break } } catch {}
  }
  if ($foxit) { break }
}
if (-not $foxit) {
  $foxit = Get-ChildItem "$env:ProgramFiles\Foxit Software", "${env:ProgramFiles(x86)}\Foxit Software" -Recurse -Include $nomes -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}

@{ pastas = $pastas; foxit = $foxit } | ConvertTo-Json | Set-Content (Join-Path $destino 'config.json') -Encoding UTF8

$chave = 'HKCU:\Software\Classes\estudopdf'
New-Item -Force $chave | Out-Null
Set-ItemProperty $chave '(default)' 'URL:Estudo PDF'
Set-ItemProperty $chave 'URL Protocol' ''
New-Item -Force "$chave\shell\open\command" | Out-Null
Set-ItemProperty "$chave\shell\open\command" '(default)' ('wscript.exe "' + (Join-Path $destino 'abrir.vbs') + '" "%1"')

Write-Host ''
Write-Host 'Instalado em' $destino
Write-Host 'Pastas:' ($pastas -join '; ')
if ($foxit) { Write-Host 'Foxit:' $foxit '(abre já na página da meta)' }
else { Write-Host 'Foxit não encontrado: os PDFs abrem no leitor padrão do Windows, na 1ª página.' }
Write-Host 'Para mudar as pastas, rode este instalador de novo.'
Write-Host 'Para desinstalar: apague a chave HKCU\Software\Classes\estudopdf e a pasta acima.'
