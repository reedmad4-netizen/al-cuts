' CLIPX AI — Windows launcher (no console window).
' Double-click this file, or use the desktop shortcut created by
' `npm run desktop:shortcut`.
Option Explicit
Dim fso, shell, root, nodeCheck

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Fail loudly instead of doing nothing if Node.js is missing.
On Error Resume Next
shell.Run "cmd /c where node >nul 2>nul", 0, True
nodeCheck = Err.Number
Err.Clear
On Error Goto 0

If nodeCheck <> 0 Or Not fso.FileExists(root & "\desktop\launch.mjs") Then
  MsgBox "CLIPX AI needs Node.js 18.18 or newer." & vbCrLf & vbCrLf & _
    "Install it from https://nodejs.org (LTS), then double-click this file again.", _
    vbExclamation, "CLIPX AI"
  WScript.Quit 1
End If

shell.CurrentDirectory = root
' 0 = hidden window; the app window itself is the browser in --app mode.
shell.Run "node ""desktop\launch.mjs""", 0, False
