!include LogicLib.nsh

!ifdef MAINBINARYNAME
  !define MILLIDA_MAIN_EXE "${MAINBINARYNAME}.exe"
!else
  !define MILLIDA_MAIN_EXE "millida-launcher.exe"
!endif

!define MILLIDA_ASIDE ".millida-old"

Var MillidaAttempt
Var MillidaProbe
Var MillidaAside
Var MillidaExitCode

; NSIS aborts the install with "Error opening file for writing" whenever the
; target is still held: the app running from the tray, an elevated instance the
; per-user installer may not terminate, a virus scanner reading the previous
; build, or a read-only attribute left by one of them. Retrying opens the same
; handle and fails again, so the file is freed here instead: attributes cleared,
; the app asked to quit, then forced, and as a last resort the locked file is
; renamed aside — Windows allows renaming a running image — and removed on the
; next reboot. The installer writes a fresh binary either way.
!macro MillidaFreeFile _file
  ${If} ${FileExists} "${_file}"
    SetFileAttributes "${_file}" NORMAL
    StrCpy $MillidaAttempt 0
    ${Do}
      ClearErrors
      FileOpen $MillidaProbe "${_file}" a
      ${IfNot} ${Errors}
        FileClose $MillidaProbe
        ${Break}
      ${EndIf}
      ${If} $MillidaAttempt == 0
        nsExec::Exec 'taskkill /IM "${MILLIDA_MAIN_EXE}"'
        Pop $MillidaExitCode
      ${ElseIf} $MillidaAttempt == 2
        nsExec::Exec 'taskkill /F /IM "${MILLIDA_MAIN_EXE}"'
        Pop $MillidaExitCode
      ${ElseIf} $MillidaAttempt == 4
        StrCpy $MillidaAside "${_file}${MILLIDA_ASIDE}"
        Delete "$MillidaAside"
        ClearErrors
        Rename "${_file}" "$MillidaAside"
        ${IfNot} ${Errors}
          Delete /REBOOTOK "$MillidaAside"
          ${Break}
        ${EndIf}
      ${ElseIf} $MillidaAttempt == 5
        StrCpy $MillidaAside "${_file}${MILLIDA_ASIDE}2"
        Delete "$MillidaAside"
        ClearErrors
        Rename "${_file}" "$MillidaAside"
        ${IfNot} ${Errors}
          Delete /REBOOTOK "$MillidaAside"
        ${EndIf}
        ${Break}
      ${EndIf}
      Sleep 600
      IntOp $MillidaAttempt $MillidaAttempt + 1
    ${Loop}
  ${EndIf}
!macroend

!macro MillidaFreeInstallDir
  !insertmacro MillidaFreeFile "$INSTDIR\${MILLIDA_MAIN_EXE}"
  !insertmacro MillidaFreeFile "$INSTDIR\WebView2Loader.dll"
  !insertmacro MillidaFreeFile "$INSTDIR\uninstall.exe"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro MillidaFreeInstallDir
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Delete /REBOOTOK "$INSTDIR\*${MILLIDA_ASIDE}*"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro MillidaFreeInstallDir
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete /REBOOTOK "$INSTDIR\*${MILLIDA_ASIDE}*"
!macroend
