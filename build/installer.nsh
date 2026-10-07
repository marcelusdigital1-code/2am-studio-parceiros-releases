!include LogicLib.nsh

; Hook executado na inicializacao do instalador antes de qualquer janela
!macro customInit
  ; Encerrar instancias anteriores e desinstalador em segundo plano para nao travar arquivos
  nsExec::Exec 'taskkill /F /T /IM "Uninstall 2AM Studio Parceiros.exe"'
  nsExec::Exec 'taskkill /F /T /IM "2AM Studio Parceiros.exe"'
  nsExec::Exec 'taskkill /F /T /IM "2am-studio-parceiros.exe"'
  Sleep 500

  Var /GLOBAL ChromeFound
  StrCpy $ChromeFound "0"

  ; 1. Checar Registro HKLM
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  ${If} $0 != ""
    ${If} ${FileExists} "$0"
      StrCpy $ChromeFound "1"
    ${EndIf}
  ${EndIf}

  ; 2. Checar Registro HKCU se ainda nao achou
  ${If} $ChromeFound == "0"
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
    ${If} $0 != ""
      ${If} ${FileExists} "$0"
        StrCpy $ChromeFound "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; 3. Checar diretorios padrao fisicos no disco
  ${If} $ChromeFound == "0"
    ${If} ${FileExists} "$PROGRAMFILES\Google\Chrome\Application\chrome.exe"
      StrCpy $ChromeFound "1"
    ${ElseIf} ${FileExists} "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
      StrCpy $ChromeFound "1"
    ${ElseIf} ${FileExists} "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
      StrCpy $ChromeFound "1"
    ${ElseIf} ${FileExists} "C:\Program Files\Google\Chrome\Application\chrome.exe"
      StrCpy $ChromeFound "1"
    ${ElseIf} ${FileExists} "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
      StrCpy $ChromeFound "1"
    ${EndIf}
  ${EndIf}

  ; Se NAO encontrou o Google Chrome, bloquear imediatamente a instalacao
  ${If} $ChromeFound == "0"
    MessageBox MB_OK|MB_ICONSTOP "BLOQUEIO DE INSTALACAO: Google Chrome Obrigatorio$\r$\n$\r$\nO 2AM Studio Parceiros requer obrigatoriamente o Google Chrome oficial instalado para operar os perfis e blindagens de seguranca.$\r$\n$\r$\nA instalacao sera interrompida. O navegador sera aberto para baixar o Chrome."
    ExecShell "open" "https://www.google.com/chrome/"
    Quit
  ${EndIf}
!macroend

; Hook executado apos concluir a instalacao
!macro customInstall
!macroend

; Hook executado na desinstalacao: apaga rigorosamente TODOS os dados, perfis, credenciais e caches
!macro customUnInstall
  SetShellVarContext current

  DetailPrint "Encerrando aplicacoes e navegadores do 2AM Studio..."
  nsExec::Exec 'taskkill /F /T /IM "2AM Studio Parceiros.exe"'
  nsExec::Exec 'taskkill /F /T /IM "2am-studio-parceiros.exe"'
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object CommandLine -match agent-windows-profiles | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'
  Sleep 1000

  DetailPrint "Limpando todos os dados, perfis e credenciais do 2AM Studio..."
  ; 1. Dados de sessao e credenciais do Electron (userData)
  RMDir /r "$APPDATA\2AM Studio Parceiros"
  RMDir /r "$APPDATA\2am-studio-parceiros"
  RMDir /r "$APPDATA\agent-windows"

  ; 2. Perfis isolados do Chrome Real (YouTube, TikTok, Facebook, Instagram)
  RMDir /r "$LOCALAPPDATA\agent-windows-profiles"
  RMDir /r "$LOCALAPPDATA\ChromeData"

  ; 3. Cofre criptografado e arquivos efemeros
  RMDir /r "$LOCALAPPDATA\.agent_vault"
  RMDir /r "$TEMP\.agent_ephemeral"

  ; 4. Pastas locais de cache e updates
  RMDir /r "$LOCALAPPDATA\2AM Studio Parceiros"
  RMDir /r "$LOCALAPPDATA\2am-studio-parceiros"
  RMDir /r "$LOCALAPPDATA\2am-studio-parceiros-updater"

  ; 5. Forcar limpeza via CMD caso pastas contenham arquivos de sistema/somente leitura
  nsExec::Exec 'cmd /c rmdir /s /q "$LOCALAPPDATA\agent-windows-profiles"'
  nsExec::Exec 'cmd /c rmdir /s /q "$LOCALAPPDATA\ChromeData"'
  nsExec::Exec 'cmd /c rmdir /s /q "$APPDATA\2AM Studio Parceiros"'
  nsExec::Exec 'cmd /c rmdir /s /q "$APPDATA\2am-studio-parceiros"'

  ; 6. Chaves de registo do 2AM Studio
  DeleteRegKey HKCU "Software\2AMStudio"
  DeleteRegKey HKCU "Software\2am-studio-parceiros"
  DeleteRegKey HKCU "Software\2AM Studio Parceiros"

  ; 7. Ficheiros temporarios
  Delete "$TEMP\2am-studio-*"
!macroend
