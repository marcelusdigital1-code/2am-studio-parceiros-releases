param(
    [int]$TargetPid,
    [switch]$Show,
    [switch]$BriefForeground,
    [switch]$SendToBack
)

if (-not $TargetPid) { exit 0 }

$cs = @'
using System;
using System.Runtime.InteropServices;

public class TaskbarHider {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT {
        public int length;
        public int flags;
        public int showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPlacement(IntPtr hWnd, [In] ref WINDOWPLACEMENT lpwndpl);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    private const int GWL_STYLE   = -16;
    private const int GWL_EXSTYLE = -20;
    private const int WS_MAXIMIZE      = 0x01000000;
    private const int WS_MAXIMIZEBOX   = 0x00010000;
    private const int WS_MINIMIZEBOX   = 0x00020000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW  = 0x00040000;

    // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED (SEM SWP_NOMOVE!)
    private const uint SWP_FLAGS_STYLE = 0x0001 | 0x0004 | 0x0010 | 0x0020;
    private const uint SWP_FLAGS_MOVE  = 0x0004 | 0x0010 | 0x0020 | 0x0040;

    public static void SetTaskbarVisibility(uint pid, bool show) {
        EnumWindows((hWnd, lParam) => {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            if (windowPid == pid) {
                int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                int style = GetWindowLong(hWnd, GWL_STYLE);
                if (exStyle != 0) {
                    if (show) {
                        SetWindowLong(hWnd, GWL_EXSTYLE, (exStyle & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW);
                        ShowWindow(hWnd, 9); // SW_RESTORE
                        SetWindowPos(hWnd, IntPtr.Zero, 150, 100, 1200, 800, SWP_FLAGS_MOVE);
                    } else {
                        // 1. Se estiver minimizada ou maximizada, cancelar estado e redefinir posição normal
                        if (IsIconic(hWnd) || IsZoomed(hWnd)) {
                            ShowWindow(hWnd, 0); // SW_HIDE
                            WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
                            wp.length = Marshal.SizeOf(wp);
                            if (GetWindowPlacement(hWnd, ref wp)) {
                                wp.rcNormalPosition.Left = 5000;
                                wp.rcNormalPosition.Top = 5000;
                                wp.rcNormalPosition.Right = 6280;
                                wp.rcNormalPosition.Bottom = 5850;
                                wp.showCmd = 0; // SW_HIDE
                                SetWindowPlacement(hWnd, ref wp);
                            }
                        } else {
                            ShowWindow(hWnd, 0); // SW_HIDE
                        }

                        // 2. Aplicar WS_EX_TOOLWINDOW e remover WS_EX_APPWINDOW
                        SetWindowLong(hWnd, GWL_EXSTYLE, (exStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);

                        // 3. Remover permissão de maximizar e minimizar do estilo da janela
                        if (style != 0) {
                            SetWindowLong(hWnd, GWL_STYLE, style & ~WS_MAXIMIZEBOX & ~WS_MAXIMIZE & ~WS_MINIMIZEBOX);
                        }

                        // 4. Mostrar novamente sem ativar
                        ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE

                        // 5. Mover offscreen SEM SWP_NOMOVE
                        SetWindowPos(hWnd, IntPtr.Zero, 5000, 5000, 1280, 850, SWP_FLAGS_MOVE);
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
    }

    public static void BringToFront(uint pid) {
        EnumWindows((hWnd, lParam) => {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            if (windowPid == pid) {
                int style = GetWindowLong(hWnd, GWL_EXSTYLE);
                if (style != 0) {
                    SetWindowLong(hWnd, GWL_EXSTYLE, (style & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW);
                }
                ShowWindow(hWnd, 9); // SW_RESTORE
                SetWindowPos(hWnd, IntPtr.Zero, 150, 100, 1150, 780, 0x0040); // SWP_SHOWWINDOW
                SetForegroundWindow(hWnd);
            }
            return true;
        }, IntPtr.Zero);
    }

    public static void SendToBack(uint pid) {
        EnumWindows((hWnd, lParam) => {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            if (windowPid == pid) {
                // Cancelar se estiver minimizada ou maximizada
                if (IsIconic(hWnd) || IsZoomed(hWnd)) {
                    ShowWindow(hWnd, 0); // SW_HIDE
                    WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
                    wp.length = Marshal.SizeOf(wp);
                    if (GetWindowPlacement(hWnd, ref wp)) {
                        wp.rcNormalPosition.Left = 5000;
                        wp.rcNormalPosition.Top = 5000;
                        wp.rcNormalPosition.Right = 6280;
                        wp.rcNormalPosition.Bottom = 5850;
                        wp.showCmd = 0; // SW_HIDE
                        SetWindowPlacement(hWnd, ref wp);
                    }
                }
                int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                if (exStyle != 0) {
                    SetWindowLong(hWnd, GWL_EXSTYLE, (exStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
                }
                int style = GetWindowLong(hWnd, GWL_STYLE);
                if (style != 0) {
                    SetWindowLong(hWnd, GWL_STYLE, style & ~WS_MAXIMIZEBOX & ~WS_MAXIMIZE & ~WS_MINIMIZEBOX);
                }
                ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE
                SetWindowPos(hWnd, IntPtr.Zero, 5000, 5000, 1280, 850, SWP_FLAGS_MOVE);
            }
            return true;
        }, IntPtr.Zero);
    }
}
'@

try {
    Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue
    $pids = @($TargetPid)
    try {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $TargetPid" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId
        if ($children) { $pids += $children }
    } catch {}

    foreach ($p in $pids) {
        if ($BriefForeground.IsPresent) {
            [TaskbarHider]::BringToFront([uint32]$p)
        } elseif ($SendToBack.IsPresent) {
            [TaskbarHider]::SendToBack([uint32]$p)
        } else {
            [TaskbarHider]::SetTaskbarVisibility([uint32]$p, [bool]$Show.IsPresent)
        }
    }
} catch {}
