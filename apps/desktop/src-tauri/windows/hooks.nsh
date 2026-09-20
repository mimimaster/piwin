; ==============================================================================
; piwin Dark Inkstone Modern UI 2 Theme Hooks
; ==============================================================================

; Set modern system UI font
SetFont "Microsoft YaHei UI" 9

; Dark background (#161514) and Ivory text (#F2F0EB)
!define MUI_BGCOLOR "161514"
!define MUI_TEXTCOLOR "F2F0EB"
!define MUI_HEADER_TRANSPARENT_TEXT
!define MUI_INSTFILESPAGE_COLORS "F2F0EB 161514"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"

; Modernized typography for Welcome Page
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 piwin"
!define MUI_WELCOMEPAGE_TEXT "piwin 是您的私有 AI 智能体工作台。\r\n\r\n· 私有内核驱动，本地原生运行\r\n· 深度代码理解与工具自主执行\r\n· 砚石明墨暗色美学，专注沉浸\r\n\r\n点击 [下一步] 继续。"

; Modernized typography for Finish Page
!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "piwin 私有 AI 智能体工作台已安装就绪。\r\n\r\n点击 [完成] 立即体验。"

; Windows 10/11 DWM Immersive Dark Mode for Title Bar
!define MUI_CUSTOMFUNCTION_GUIINIT SetImmersiveDarkMode
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.SetImmersiveDarkMode

Function SetImmersiveDarkMode
  ; 20 = DWMWA_USE_IMMERSIVE_DARK_MODE for Windows 10 (20H1+) and Windows 11
  ; 19 = DWMWA_USE_IMMERSIVE_DARK_MODE for Windows 10 (1809 - 1909)
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4)'

  ; Hide retro etched separator line (control 1035)
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 0

  ; Subtle branding text styling (control 1028)
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 0x8C8882 transparent
FunctionEnd

Function un.SetImmersiveDarkMode
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4)'

  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 0

  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 0x8C8882 transparent
FunctionEnd
