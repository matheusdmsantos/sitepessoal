' Chamado pelo link estudopdf: (registrado pelo instalar.ps1). Roda o abrir.ps1 sem abrir janela.
If WScript.Arguments.Count = 0 Then WScript.Quit
pasta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
url = Replace(WScript.Arguments(0), """", "")
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & pasta & "\abrir.ps1"" """ & url & """", 0, False
