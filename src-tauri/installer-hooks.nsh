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
Var MillidaGameRoot
Var MillidaIndex
Var MillidaName
Var MillidaPrefix
Var MillidaLen
Var MillidaWipe
Var MillidaFind
Var MillidaEntry

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

; The game folder the player picked lives in game-root.txt inside the app data,
; read before the uninstall removes anything.
!macro MillidaReadGameRoot
  SetShellVarContext current
  StrCpy $MillidaGameRoot ""
  ClearErrors
  FileOpen $MillidaProbe "$APPDATA\net.millida.launcher\game-root.txt" r
  ${IfNot} ${Errors}
    FileRead $MillidaProbe $MillidaGameRoot
    FileClose $MillidaProbe
  ${EndIf}
  ; Trim the line break.
  ${Do}
    StrCpy $MillidaName $MillidaGameRoot 1 -1
    ${If} $MillidaName == "$\r"
    ${OrIf} $MillidaName == "$\n"
      StrCpy $MillidaGameRoot $MillidaGameRoot -1
    ${Else}
      ${Break}
    ${EndIf}
  ${Loop}
!macroend

; Graphics card choices the launcher wrote for its own java (engine/game/gpu.rs) are
; values named by the java path under UserGpuPreferences: remove the ones under
; _prefix only. Deleting shifts the index, so it only moves on a kept value.
!macro MillidaDropGpuPrefs _prefix
  StrCpy $MillidaPrefix "${_prefix}"
  StrLen $MillidaLen $MillidaPrefix
  ${If} $MillidaLen > 3
    StrCpy $MillidaIndex 0
    ${Do}
      ClearErrors
      EnumRegValue $MillidaName HKCU "Software\Microsoft\DirectX\UserGpuPreferences" $MillidaIndex
      ${If} ${Errors}
      ${OrIf} $MillidaName == ""
        ${Break}
      ${EndIf}
      StrCpy $MillidaProbe $MillidaName $MillidaLen
      ${If} $MillidaProbe == $MillidaPrefix
        DeleteRegValue HKCU "Software\Microsoft\DirectX\UserGpuPreferences" $MillidaName
      ${Else}
        IntOp $MillidaIndex $MillidaIndex + 1
      ${EndIf}
    ${Loop}
  ${EndIf}
!macroend

; Empties _dir except the entries named _keep1/_keep2/_keep3 («-» keeps nothing more).
!macro MillidaWipeDirExcept _dir _keep1 _keep2 _keep3
  ClearErrors
  FindFirst $MillidaFind $MillidaEntry "${_dir}\*"
  ${DoUntil} ${Errors}
    ${If} $MillidaEntry != "."
    ${AndIf} $MillidaEntry != ".."
    ${AndIf} $MillidaEntry != "${_keep1}"
    ${AndIf} $MillidaEntry != "${_keep2}"
    ${AndIf} $MillidaEntry != "${_keep3}"
      ${If} ${FileExists} "${_dir}\$MillidaEntry\*"
        RmDir /r "${_dir}\$MillidaEntry"
      ${Else}
        Delete "${_dir}\$MillidaEntry"
      ${EndIf}
    ${EndIf}
    ClearErrors
    FindNext $MillidaFind $MillidaEntry
  ${Loop}
  FindClose $MillidaFind
!macroend

; The «delete app data» box stands for accounts, settings and caches, but Tauri's own
; handling removes the whole app data folder, and with it the default game folder:
; a player reinstalling the launcher lost builds and worlds played for weeks. The
; box is taken over before Tauri acts on it and the same folders are emptied here,
; keeping the builds (minecraft\profiles), their list and the pointer to a game
; folder picked by hand. The launcher adopts kept build folders on the next start.
!macro MillidaWipeKeepingBuilds _roaming _local
  RmDir /r "${_local}"
  !insertmacro MillidaWipeDirExcept "${_roaming}" "minecraft" "profiles.json" "game-root.txt"
  !insertmacro MillidaWipeDirExcept "${_roaming}\minecraft" "profiles" "-" "-"
  RmDir "${_roaming}\minecraft"
  RmDir "${_roaming}"
!macroend

; What the uninstaller always removes, «delete app data» box or not: the WebView2
; caches (never the page's own storage), the autostart entries, the millida:// link
; if it still points here and the GPU choices for our java. Accounts and settings
; stay unless the player ticks the box; builds and worlds stay always. The page keeps the
; account list, the statistics opt-out and its other settings in WebView2's Local
; Storage and IndexedDB, so those folders are left alone here. A game folder picked
; by hand is never removed — it may be shared with another launcher. Updates
; (/UPDATE) keep everything.
!macro MillidaCleanTraces
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\Default\Cache"
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\Default\Code Cache"
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\Default\GPUCache"
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\Default\DawnGraphiteCache"
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\Default\DawnWebGPUCache"
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\Default\Service Worker\CacheStorage"
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\GrShaderCache"
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\GraphiteDawnCache"
    RmDir /r "$LOCALAPPDATA\net.millida.launcher\EBWebView\ShaderCache"
    RmDir /r "$APPDATA\net.millida.launcher\tmp"
    ; The notification id the launcher registers for toasts when there is no Start menu shortcut.
    DeleteRegKey HKCU "Software\Classes\AppUserModelId\net.millida.launcher"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Millida Launcher"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Millida Launcher"
    ReadRegStr $MillidaName HKCU "Software\Classes\millida\shell\open\command" ""
    StrCpy $MillidaPrefix "$\"$INSTDIR\${MILLIDA_MAIN_EXE}$\""
    StrLen $MillidaLen $MillidaPrefix
    StrCpy $MillidaProbe $MillidaName $MillidaLen
    ${If} $MillidaProbe == $MillidaPrefix
      DeleteRegKey HKCU "Software\Classes\millida"
    ${EndIf}
    !insertmacro MillidaDropGpuPrefs "$APPDATA\net.millida.launcher\"
    ${If} $MillidaGameRoot != ""
      ; Only the launcher's own java folder: a shared root such as D:\Games\ holds
      ; other launchers' java too, and their graphics choices are not ours to drop.
      !insertmacro MillidaDropGpuPrefs "$MillidaGameRoot\runtime\"
    ${EndIf}
  ${EndIf}
!macroend

; The report runs after the running launcher is closed: a heartbeat sent later
; would mark the install alive again on the server. The timeout keeps a hung
; network from holding the uninstall.
!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $MillidaWipe 0
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    StrCpy $DeleteAppDataCheckboxState 0
    StrCpy $MillidaWipe 1
  ${EndIf}
  !insertmacro MillidaReadGameRoot
  !insertmacro MillidaFreeInstallDir
  ${If} ${FileExists} "$INSTDIR\${MILLIDA_MAIN_EXE}"
    nsExec::Exec /TIMEOUT=10000 '"$INSTDIR\${MILLIDA_MAIN_EXE}" --report-uninstall'
    Pop $MillidaExitCode
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete /REBOOTOK "$INSTDIR\*${MILLIDA_ASIDE}*"
  !insertmacro MillidaCleanTraces
  ${If} $MillidaWipe = 1
    SetShellVarContext current
    !insertmacro MillidaWipeKeepingBuilds "$APPDATA\net.millida.launcher" "$LOCALAPPDATA\net.millida.launcher"
  ${EndIf}
!macroend
