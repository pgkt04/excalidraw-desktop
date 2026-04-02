; Custom NSIS installer script for Excalidraw Desktop
; Adds a file association checkbox page to the installer wizard.
;
; How it works:
;   electron-builder auto-registers .excalidraw file associations via the
;   fileAssociations config in package.json (registerFileAssociations macro).
;   This script adds a checkbox page so the user can opt out. If unchecked,
;   customInstall undoes the auto-registration. The uninstaller always cleans up.

!include "FileAssociation.nsh"

; Variable to track checkbox state ("1" = associate, "0" = skip)
Var FileAssocCheckbox
Var FileAssocState

; -------------------------------------------------------------------
; Custom page: file association checkbox (after directory selection)
; -------------------------------------------------------------------
!macro customPageAfterChangeDir
  Page custom FileAssocPageCreate FileAssocPageLeave
!macroend

Function FileAssocPageCreate
  ; Skip on silent/update installs
  ${if} ${isUpdated}
    Abort
  ${endif}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "File Associations" "Configure file type associations."

  ${NSD_CreateCheckbox} 0 0 100% 12u "Associate .excalidraw files with Excalidraw"
  Pop $FileAssocCheckbox
  ; Checked by default
  ${NSD_Check} $FileAssocCheckbox

  nsDialogs::Show
FunctionEnd

Function FileAssocPageLeave
  ${NSD_GetState} $FileAssocCheckbox $0
  ${If} $0 == ${BST_UNCHECKED}
    StrCpy $FileAssocState "0"
  ${Else}
    StrCpy $FileAssocState "1"
  ${EndIf}
FunctionEnd

; -------------------------------------------------------------------
; After install: undo file association if user opted out
; -------------------------------------------------------------------
!macro customInstall
  ; electron-builder already called registerFileAssociations at this point.
  ; If the user unchecked the box, undo it.
  ${if} $FileAssocState == "0"
    !insertmacro APP_UNASSOCIATE "excalidraw" "Excalidraw.Drawing"
    !insertmacro UPDATEFILEASSOC
  ${endif}
!macroend

; -------------------------------------------------------------------
; Uninstall: always clean up file association
; -------------------------------------------------------------------
!macro customUnInstall
  !insertmacro APP_UNASSOCIATE "excalidraw" "Excalidraw.Drawing"
  !insertmacro UPDATEFILEASSOC
!macroend
