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

    [DllImport("user32.dll")]
    public static extern IntPtr GetSystemMenu(IntPtr hWnd, bool bRevert);

    [DllImport("user32.dll")]
    public static extern int GetMenuItemCount(IntPtr hMenu);

    [DllImport("user32.dll")]
    public static extern bool RemoveMenu(IntPtr hMenu, uint uPosition, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool EnableMenuItem(IntPtr hMenu, uint uIDEnableItem, uint uEnable);

    [DllImport("user32.dll")]
    public static extern bool DeleteMenu(IntPtr hMenu, uint uPosition, uint uFlags);

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
    private const int WS_SYSMENU       = 0x00080000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW  = 0x00040000;
    private const int WS_EX_NOACTIVATE = 0x08000000;

    private const uint SC_SIZE      = 0xF000;
    private const uint SC_MOVE      = 0xF010;
    private const uint SC_MINIMIZE  = 0xF020;
    private const uint SC_MAXIMIZE  = 0xF030;
    private const uint SC_RESTORE   = 0xF120;

    private const uint MF_BYCOMMAND  = 0x00000000;
    private const uint MF_BYPOSITION = 0x00000400;
    private const uint MF_GRAYED     = 0x00000001;
    private const uint MF_DISABLED   = 0x00000002;

    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
    private const uint SWP_FLAGS_STYLE = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020;
    private const uint SWP_FLAGS_MOVE  = 0x0004 | 0x0010 | 0x0020 | 0x0040;

    private static void DestroySystemMenu(IntPtr hWnd) {
        IntPtr hMenu = GetSystemMenu(hWnd, false);
        if (hMenu != IntPtr.Zero) {
            EnableMenuItem(hMenu, SC_MAXIMIZE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
            EnableMenuItem(hMenu, SC_RESTORE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
            EnableMenuItem(hMenu, SC_SIZE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
            EnableMenuItem(hMenu, SC_MOVE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
            DeleteMenu(hMenu, SC_MAXIMIZE, MF_BYCOMMAND);
            DeleteMenu(hMenu, SC_RESTORE, MF_BYCOMMAND);
            int count = GetMenuItemCount(hMenu);
            for (int i = count - 1; i >= 0; i--) {
                RemoveMenu(hMenu, (uint)i, MF_BYPOSITION);
            }
        }
    }

    public static void SetTaskbarVisibility(uint pid, bool show) {
        EnumWindows((hWnd, lParam) => {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            if (windowPid == pid) {
                int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                int style = GetWindowLong(hWnd, GWL_STYLE);
                if (exStyle != 0) {
                    if (show) {
                        SetWindowLong(hWnd, GWL_EXSTYLE, (exStyle & ~WS_EX_TOOLWINDOW & ~WS_EX_NOACTIVATE) | WS_EX_APPWINDOW);
                        ShowWindow(hWnd, 9); // SW_RESTORE
                        SetWindowPos(hWnd, IntPtr.Zero, 150, 100, 1200, 800, SWP_FLAGS_MOVE);
                    } else {
                        // 1. Cancelar estado minimizado/maximizado e ocultar
                        if (IsIconic(hWnd) || IsZoomed(hWnd)) {
                            ShowWindow(hWnd, 0); // SW_HIDE
                            WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
                            wp.length = Marshal.SizeOf(wp);
                            if (GetWindowPlacement(hWnd, ref wp)) {
                                wp.rcNormalPosition.Left = -32000;
                                wp.rcNormalPosition.Top = -32000;
                                wp.rcNormalPosition.Right = -30800;
                                wp.rcNormalPosition.Bottom = -31190;
                                wp.showCmd = 0; // SW_HIDE
                                SetWindowPlacement(hWnd, ref wp);
                            }
                        } else {
                            ShowWindow(hWnd, 0); // SW_HIDE
                        }

                        // 2. Aplicar WS_EX_TOOLWINDOW + WS_EX_NOACTIVATE e remover WS_EX_APPWINDOW
                        SetWindowLong(hWnd, GWL_EXSTYLE, (exStyle | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW);

                        // 3. Remover WS_MAXIMIZEBOX, WS_MINIMIZE, WS_MAXIMIZE e WS_SYSMENU
                        if (style != 0) {
                            SetWindowLong(hWnd, GWL_STYLE, style & ~WS_MAXIMIZEBOX & ~WS_MAXIMIZE & ~WS_MINIMIZEBOX & ~WS_SYSMENU);
                        }

                        // 4. Destruir completamente o menu de sistema (clique direito)
                        try { DestroySystemMenu(hWnd); } catch {}

                        // 5. Mostrar novamente sem ativar
                        ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE

                        // 6. Mover offscreen
                        SetWindowPos(hWnd, IntPtr.Zero, -32000, -32000, 1200, 810, SWP_FLAGS_MOVE);
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
    }

    public static void BringToFront(uint pid) {
        // Bloqueado: publicação é estritamente em segundo plano
        // Mantém a janela offscreen
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
                        wp.rcNormalPosition.Left = -32000;
                        wp.rcNormalPosition.Top = -32000;
                        wp.rcNormalPosition.Right = -30800;
                        wp.rcNormalPosition.Bottom = -31190;
                        wp.showCmd = 0; // SW_HIDE
                        SetWindowPlacement(hWnd, ref wp);
                    }
                }
                int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                if (exStyle != 0) {
                    SetWindowLong(hWnd, GWL_EXSTYLE, (exStyle | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW);
                }
                int style = GetWindowLong(hWnd, GWL_STYLE);
                if (style != 0) {
                    SetWindowLong(hWnd, GWL_STYLE, style & ~WS_MAXIMIZEBOX & ~WS_MAXIMIZE & ~WS_MINIMIZEBOX & ~WS_SYSMENU);
                }
                try { DestroySystemMenu(hWnd); } catch {}
                ShowWindow(hWnd, 0); // SW_HIDE
                ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE
                SetWindowPos(hWnd, IntPtr.Zero, -32000, -32000, 1200, 810, SWP_FLAGS_MOVE);
            }
            return true;
        }, IntPtr.Zero);
    }
}
'@

try {
    Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue
    # Buscar recursivamente todos os descendentes (filhos, netos, bisnetos, etc.)
    $pids = @($TargetPid)
    $queue = [System.Collections.Queue]::new()
    $queue.Enqueue($TargetPid)
    try {
        $allProcs = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId -ErrorAction SilentlyContinue
        if ($allProcs) {
            while ($queue.Count -gt 0) {
                $parentId = $queue.Dequeue()
                foreach ($p in $allProcs) {
                    if ($p.ParentProcessId -eq $parentId -and $p.ProcessId -ne $parentId) {
                        $pids += $p.ProcessId
                        $queue.Enqueue($p.ProcessId)
                    }
                }
            }
        }
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
