param(
    [int]$TargetPid
)

if (-not $TargetPid) { exit 0 }

$cs = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[ComImport]
[Guid("56FDF342-FD6D-11d0-958A-006097C9A090")]
[ClassInterface(ClassInterfaceType.None)]
public class TaskbarList { }

[ComImport]
[Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ITaskbarList {
    void HrInit();
    void AddTab(IntPtr hWnd);
    void DeleteTab(IntPtr hWnd);
    void ActivateTab(IntPtr hWnd);
    void SetActiveAlt(IntPtr hWnd);
}

public class WindowKeeper {
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

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern IntPtr GetSystemMenu(IntPtr hWnd, bool bRevert);

    [DllImport("user32.dll")]
    public static extern bool DeleteMenu(IntPtr hMenu, uint uPosition, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool EnableMenuItem(IntPtr hMenu, uint uIDEnableItem, uint uEnable);

    [DllImport("user32.dll")]
    public static extern int GetMenuItemCount(IntPtr hMenu);

    [DllImport("user32.dll")]
    public static extern bool RemoveMenu(IntPtr hMenu, uint uPosition, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPlacement(IntPtr hWnd, [In] ref WINDOWPLACEMENT lpwndpl);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    private const int GWL_STYLE   = -16;
    private const int GWL_EXSTYLE = -20;

    private const int WS_MAXIMIZE      = 0x01000000;
    private const int WS_MAXIMIZEBOX   = 0x00010000;
    private const int WS_MINIMIZEBOX   = 0x00020000;
    private const int WS_SYSMENU       = 0x00080000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW  = 0x00040000;
    private const int WS_EX_NOACTIVATE = 0x08000000;

    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
    private const uint SWP_FLAGS_STYLE = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020;
    // SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW (com move + resize)
    private const uint SWP_FLAGS_MOVE  = 0x0004 | 0x0010 | 0x0020 | 0x0040;

    private const uint SC_SIZE      = 0xF000;
    private const uint SC_MOVE      = 0xF010;
    private const uint SC_MINIMIZE  = 0xF020;
    private const uint SC_MAXIMIZE  = 0xF030;
    private const uint SC_CLOSE     = 0xF060;
    private const uint SC_RESTORE   = 0xF120;

    private const uint MF_BYCOMMAND  = 0x00000000;
    private const uint MF_BYPOSITION = 0x00000400;
    private const uint MF_GRAYED     = 0x00000001;
    private const uint MF_DISABLED   = 0x00000002;

    private static ITaskbarList _taskbarList;

    static WindowKeeper() {
        try {
            _taskbarList = (ITaskbarList)new TaskbarList();
            _taskbarList.HrInit();
        } catch {}
    }

    private static void GuardSingleWindow(IntPtr hWnd) {
        bool changed = false;

        // ── 1. Remover SEMPRE da barra de tarefas via ITaskbarList COM ──
        try {
            if (_taskbarList != null) {
                _taskbarList.DeleteTab(hWnd);
            }
        } catch {}

        // ── 2. Aplicar WS_EX_TOOLWINDOW + WS_EX_NOACTIVATE e remover WS_EX_APPWINDOW ──
        //       Isto impede a janela de aparecer na barra de tarefas e no Alt+Tab.
        try {
            int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
            if (exStyle != 0) {
                int neededEx = (exStyle | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW;
                if (exStyle != neededEx) {
                    SetWindowLong(hWnd, GWL_EXSTYLE, neededEx);
                    SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0, SWP_FLAGS_STYLE);
                    changed = true;
                }
            }
        } catch {}

        // ── 3. Tratar janela MINIMIZADA (IsIconic) ou MAXIMIZADA (IsZoomed) ──
        try {
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
                ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE
                SetWindowPos(hWnd, IntPtr.Zero, -32000, -32000, 1200, 810, SWP_FLAGS_MOVE);
                changed = true;
            }
        } catch {}

        // ── 4. Bloquear maximizar/minimizar e remover WS_SYSMENU ──
        //       Remover WS_SYSMENU e WS_MAXIMIZEBOX impede o Chrome de mostrar qualquer menu
        //       de contexto no clique direito na barra de tarefas ou permitir maximizar.
        try {
            int style = GetWindowLong(hWnd, GWL_STYLE);
            if (style != 0) {
                if (IsZoomed(hWnd) || (style & WS_MAXIMIZE) != 0) {
                    ShowWindow(hWnd, 0); // SW_HIDE
                    ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE
                    SetWindowPos(hWnd, IntPtr.Zero, -32000, -32000, 1200, 810, SWP_FLAGS_MOVE);
                    style = GetWindowLong(hWnd, GWL_STYLE);
                    changed = true;
                }

                int neededStyle = style & ~WS_MAXIMIZEBOX & ~WS_MAXIMIZE & ~WS_MINIMIZEBOX & ~WS_SYSMENU;
                if (style != neededStyle) {
                    SetWindowLong(hWnd, GWL_STYLE, neededStyle);
                    SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0, SWP_FLAGS_STYLE);
                    changed = true;
                }
            }
        } catch {}

        // ── 5. Destruir completamente o menu de sistema ──
        //       Desabilitar e deletar SC_MAXIMIZE, SC_RESTORE, SC_SIZE, SC_MOVE
        //       e remover todos os itens do menu para impedir qualquer menu de contexto.
        try {
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
        } catch {}

        // ── 6. Ciclo SW_HIDE + SW_SHOWNOACTIVATE apenas se os estilos foram alterados ──
        try {
            if (changed && IsWindowVisible(hWnd)) {
                ShowWindow(hWnd, 0); // SW_HIDE
                ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE
            }
        } catch {}

        // ── 7. Forçar coordenadas offscreen (-32000, -32000) se estiver visível na tela ──
        try {
            RECT rect;
            if (GetWindowRect(hWnd, out rect)) {
                if (rect.Left > -10000 || rect.Top > -10000) {
                    WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
                    wp.length = Marshal.SizeOf(wp);
                    if (GetWindowPlacement(hWnd, ref wp)) {
                        wp.rcNormalPosition.Left = -32000;
                        wp.rcNormalPosition.Top = -32000;
                        wp.rcNormalPosition.Right = -30800;
                        wp.rcNormalPosition.Bottom = -31190;
                        SetWindowPlacement(hWnd, ref wp);
                    }
                    SetWindowPos(hWnd, IntPtr.Zero, -32000, -32000, 1200, 810, SWP_FLAGS_MOVE);
                }
            }
        } catch {}

        // ── 8. Garantir remoção da taskbar novamente após todas as alterações ──
        try {
            if (_taskbarList != null) {
                _taskbarList.DeleteTab(hWnd);
            }
        } catch {}
    }

    public static void GuardWindows(uint[] pids) {
        EnumWindows((hWnd, lParam) => {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            foreach (uint p in pids) {
                if (windowPid == p) {
                    GuardSingleWindow(hWnd);
                    // NÃO usar break: processar TODAS as janelas do mesmo PID
                    // (Chrome pode ter múltiplas janelas, popups, diálogos)
                }
            }
            return true;
        }, IntPtr.Zero);
    }
}
'@

function Get-AllDescendantPids {
    param([int]$RootPid)
    $result = @([uint32]$RootPid)
    $queue = [System.Collections.Queue]::new()
    $queue.Enqueue($RootPid)
    try {
        # Obter TODOS os processos de uma vez para evitar múltiplas queries WMI
        $allProcs = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId -ErrorAction SilentlyContinue
        if ($allProcs) {
            while ($queue.Count -gt 0) {
                $parentId = $queue.Dequeue()
                foreach ($p in $allProcs) {
                    if ($p.ParentProcessId -eq $parentId -and $p.ProcessId -ne $parentId) {
                        $result += [uint32]$p.ProcessId
                        $queue.Enqueue($p.ProcessId)
                    }
                }
            }
        }
    } catch {}
    return $result
}

try {
    Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue

    $iter = 0
    $cachedPids = @([uint32]$TargetPid)
    $pauseFile = Join-Path $env:TEMP "keeper_pause_$TargetPid.flag"

    while ($true) {
        $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        if (-not $proc -or $proc.HasExited) { break }

        # Se houver pedido de pausa ativa, aguardar
        if (Test-Path $pauseFile) {
            Start-Sleep -Milliseconds 60
            continue
        }

        # Actualizar lista de PIDs descendentes a cada 5 iteracoes (~0.4s)
        # Busca recursiva: filhos, netos, bisnetos, etc.
        if ($iter % 5 -eq 0) {
            $cachedPids = Get-AllDescendantPids -RootPid $TargetPid
        }
        $iter++

        [WindowKeeper]::GuardWindows($cachedPids)
        Start-Sleep -Milliseconds 80
    }
} catch {}
