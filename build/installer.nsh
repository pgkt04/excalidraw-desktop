; Custom NSIS installer script for Excalidraw Desktop
; Adds an "Additional Options" page to the installer wizard with checkboxes for:
;   - .excalidraw file association (checked by default)
;   - Desktop shortcut (checked by default)
;
; How it works:
;   electron-builder auto-registers .excalidraw file associations via the
;   fileAssociations config in package.json (registerFileAssociations macro).
;   This script adds checkboxes so the user can opt out. If unchecked,
;   customInstall undoes the auto-registration. Desktop shortcut is created
;   manually since createDesktopShortcut is set to false in package.json.
;   The uninstaller always cleans up both.

!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

; Variables for file association checkbox
Var FileAssocCheckbox
Var FileAssocState

; Variables for desktop shortcut checkbox
Var DesktopShortcutCheckbox
Var DesktopShortcutState

; -------------------------------------------------------------------
; Custom page: additional options (after directory selection)
; -------------------------------------------------------------------
!macro customPageAfterChangeDir
  Page custom OptionsPageCreate OptionsPageLeave
!macroend

Function OptionsPageCreate
  ; Skip on silent/update installs
  ${If} ${isUpdated}
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ; Set header text directly via SendMessage. MUI_HEADER_TEXT is not available
  ; because this .nsh is included before MUI2.nsh in electron-builder's
  ; generated script. Control IDs 1037/1038 are the MUI header text controls.
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Additional Options"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Configure additional installation options."

  ; File association checkbox (checked by default)
  ${NSD_CreateCheckbox} 0 0 100% 12u "Associate .excalidraw files with Excalidraw"
  Pop $FileAssocCheckbox
  ${NSD_Check} $FileAssocCheckbox

  ; Desktop shortcut checkbox (checked by default)
  ${NSD_CreateCheckbox} 0 18u 100% 12u "Create desktop shortcut"
  Pop $DesktopShortcutCheckbox
  ${NSD_Check} $DesktopShortcutCheckbox

  nsDialogs::Show
FunctionEnd

Function OptionsPageLeave
  ; Read file association checkbox state
  ${NSD_GetState} $FileAssocCheckbox $0
  ${If} $0 == ${BST_UNCHECKED}
    StrCpy $FileAssocState "0"
  ${Else}
    StrCpy $FileAssocState "1"
  ${EndIf}

  ; Read desktop shortcut checkbox state
  ${NSD_GetState} $DesktopShortcutCheckbox $0
  ${If} $0 == ${BST_UNCHECKED}
    StrCpy $DesktopShortcutState "0"
  ${Else}
    StrCpy $DesktopShortcutState "1"
  ${EndIf}
FunctionEnd

; -------------------------------------------------------------------
; After install: apply user choices
; -------------------------------------------------------------------
!macro customInstall
  ; File association: electron-builder already called registerFileAssociations.
  ; If the user unchecked the box, undo it.
  ${If} $FileAssocState == "0"
    !insertmacro APP_UNASSOCIATE "excalidraw" "Excalidraw.Drawing"
    !insertmacro UPDATEFILEASSOC
  ${EndIf}

  ; Desktop shortcut: create only if the user checked the box.
  ${If} $DesktopShortcutState == "1"
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$appExe"
  ${EndIf}
!macroend

; -------------------------------------------------------------------
; Uninstall: always clean up everything
; -------------------------------------------------------------------
!macro customUnInstall
  !insertmacro APP_UNASSOCIATE "excalidraw" "Excalidraw.Drawing"
  !insertmacro UPDATEFILEASSOC
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
!macroend
