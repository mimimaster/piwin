Unicode true
OutFile "D:\src\pw-spike.exe"
InstallDir "$TEMP\pw-spike"
RequestExecutionLevel user
Name "pw-spike"
ShowInstDetails show

!include "MUI2.nsh"
!include "FileFunc.nsh"

Var Log

!define WM_SETFONT_PW 0x0030
!define STM_SETICON_PW 0x0170

!define MUI_PAGE_CUSTOMFUNCTION_SHOW SpikeShow
!insertmacro MUI_PAGE_INSTFILES

Function .onInit
  FileOpen $Log "D:\src\pw-spike.log" w
  FileWrite $Log "onInit hwndparent=[$HWNDPARENT]$\r$\n"
FunctionEnd

Function SpikeShow
  FileWrite $Log "show hwndparent=[$HWNDPARENT]$\r$\n"

  ; 1. dpi via $R register output
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .R0'
  FileWrite $Log "1a GetDpiForWindow .R0=[$R0] errors=$\r$\n"

  ; 2. dpi via $ register output
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .r0'
  FileWrite $Log "1b GetDpiForWindow .r0=[$0]$\r$\n"

  ; 3. System::Alloc
  System::Alloc 16
  Pop $R3
  FileWrite $Log "2  Alloc R3=[$R3]$\r$\n"

  ; 4. GetClientRect + struct read
  System::Call 'user32::GetClientRect(p $HWNDPARENT, p r3) i .r5'
  FileWrite $Log "3a GetClientRect ret=[$5]$\r$\n"
  System::Call '*$R3(i .r6, i .r7, i .r8, i .r9)'
  FileWrite $Log "3b rect l=[$6] t=[$7] r=[$8] b=[$9]$\r$\n"
  System::Free $R3

  ; 5. SystemParametersInfo SPI_GETWORKAREA
  System::Alloc 16
  Pop $R3
  System::Call 'user32::SystemParametersInfoW(i 48, i 0, p r3, i 0) i .r5'
  FileWrite $Log "4a SPI ret=[$5]$\r$\n"
  System::Call '*$R3(i .r6, i .r7, i .r8, i .r9)'
  FileWrite $Log "4b workarea l=[$6] t=[$7] r=[$8] b=[$9]$\r$\n"
  System::Free $R3

  ; 6. system metrics
  System::Call 'user32::GetSystemMetrics(i 11) i .r6'
  System::Call 'user32::GetSystemMetrics(i 12) i .r7'
  FileWrite $Log "5  SM_CXICON=[$6] SM_CYICON=[$7]$\r$\n"

  ; 7. module handle + icon resource 1
  System::Call 'kernel32::GetModuleHandleW(p 0) p .R1'
  FileWrite $Log "6a GetModuleHandle R1=[$R1]$\r$\n"
  System::Call 'user32::LoadIconW(p r1, p 1) p .R2'
  FileWrite $Log "6b LoadIconW R2=[$R2]$\r$\n"

  ; 8. font
  System::Call 'gdi32::CreateFontW(i -30, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 134, i 0, i 0, i 5, i 0, w "Microsoft YaHei UI") p .R4'
  FileWrite $Log "7  CreateFontW R4=[$R4]$\r$\n"

  ; 9. inner dialog lookup
  FindWindow $R5 "#32770" "" $HWNDPARENT
  FileWrite $Log "8  FindWindow inner=[$R5]$\r$\n"

  ; 10. create a static on the inner dialog + set the icon
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000003, i 30, i 30, i r6, i r7, p r5, i 0, i 0, i 0) p .R7'
  FileWrite $Log "9  CreateWindowEx static=[$R7]$\r$\n"
  SendMessage $R7 ${STM_SETICON_PW} $R2 0
  FileWrite $Log "9b STM_SETICON sent$\r$\n"
  SendMessage $R7 ${WM_SETFONT_PW} $R4 1
  SetCtlColors $R7 0xDAE5EB 0x101214
  FileWrite $Log "9c font + colors applied$\r$\n"

  ; 11. uxtheme with empty strings
  System::Call 'uxtheme::SetWindowTheme(p r7, w "", w "") i .r8'
  FileWrite $Log "10 SetWindowTheme ret=[$8] (0 = ok)$\r$\n"

  ; 12. resize the dialog from the client rect
  System::Call 'user32::GetClientRect(p $HWNDPARENT, p r3)'
  System::Alloc 16
  Pop $R3
  System::Call 'user32::GetClientRect(p $HWNDPARENT, p r3)'
  System::Call '*$R3(i .r4, i .r5, i .r6, i .r7)'
  System::Free $R3
  FileWrite $Log "11 client w=[$6] h=[$7]$\r$\n"
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i 200, i 200, i 600, i 300, i 0x0004) i .r8'
  FileWrite $Log "12 SetWindowPos ret=[$8]$\r$\n"
  System::Call 'user32::SetWindowTextW(p $HWNDPARENT, w "piwin 安装程序") i .r8'
  FileWrite $Log "13 SetWindowTextW ret=[$8]$\r$\n"
  SetCtlColors $HWNDPARENT 0xDAE5EB 0x101214
  FileWrite $Log "14 dialog colours applied$\r$\n"

  FileWrite $Log "SPIKE DONE$\r$\n"
  FileClose $Log
  SetAutoClose true
FunctionEnd

Section
  Sleep 4000
SectionEnd
