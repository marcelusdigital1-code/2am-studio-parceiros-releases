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
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPlacement(IntPtr hWnd, [In] ref WINDOWPLACEMENT lpwndpl);

    private const int GWL_STYLE   = -16;
    private const int GWL_EXSTYLE = -20;

    private const int WS_MAXIMIZE      = 0x01000000;
    private const int WS_MAXIMIZEBOX   = 0x00010000;
    private const int WS_MINIMIZEBOX   = 0x00020000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW  = 0x00040000;

    // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED (SEM SWP_NOMOVE!)
    private const uint SWP_FLAGS_STYLE = 0x0001 | 0x0004 | 0x0010 | 0x0020;
    // Flags para mover para coordenadas offscreen garantindo que não há restrições
    private const uint SWP_FLAGS_MOVE  = 0x0004 | 0x0010 | 0x0020 | 0x0040; // SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW

    private const uint SC_SIZE      = 0xF000;
    private const uint SC_MOVE      = 0xF010;
    private const uint SC_MINIMIZE  = 0xF020;
    private const uint SC_MAXIMIZE  = 0xF030;
    private const uint SC_RESTORE   = 0xF120;

    private const uint MF_BYCOMMAND = 0x00000000;
    private const uint MF_GRAYED    = 0x00000001;
    private const uint MF_DISABLED  = 0x00000002;

    private static ITaskbarList _taskbarList;

    static WindowKeeper() {
        try {
            _taskbarList = (ITaskbarList)new TaskbarList();
            _taskbarList.HrInit();
        } catch {}
    }

    public static void GuardWindows(uint[] pids) {
        EnumWindows((hWnd, lParam) => {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            foreach (uint p in pids) {
                if (windowPid == p) {
                    // 1. Remover SEMPRE da barra de tarefas via ITaskbarList
                    try {
                        if (_taskbarList != null) {
                            _taskbarList.DeleteTab(hWnd);
                        }
                    } catch {}

                    // 2. Aplicar WS_EX_TOOLWINDOW SEMPRE (impede aparicao na barra e Alt+Tab)
                    try {
                        int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                        if (exStyle != 0) {
                            int neededEx = (exStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
                            if (exStyle != neededEx) {
                                SetWindowLong(hWnd, GWL_EXSTYLE, neededEx);
                                SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0, SWP_FLAGS_STYLE);
                            }
                        }
                    } catch {}

                    // 3. Tratar janela MINIMIZADA (IsIconic):
                    //    Se o usuário minimizou a janela no login visível e o fluxo mudou para segundo plano:
                    //    O Windows mantém o botão minimizado na barra. Cancelamos o estado minimizado,
                    //    definimos a posição de restauração para (5000, 5000) e ocultamos da barra.
                    try {
                        if (IsIconic(hWnd)) {
                            ShowWindow(hWnd, 0); // SW_HIDE (destrói o botão na barra de tarefas)
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
                            ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE
                            SetWindowPos(hWnd, IntPtr.Zero, 5000, 5000, 1280, 850, SWP_FLAGS_MOVE);
                        }
                    } catch {}

                    // 4. Bloquear permanentemente "Maximizar", "Restaurar" e desfazer qualquer estado maximizado
                    try {
                        int style = GetWindowLong(hWnd, GWL_STYLE);
                        if (style != 0) {
                            if (IsZoomed(hWnd) || (style & WS_MAXIMIZE) != 0) {
                                ShowWindow(hWnd, 4); // SW_SHOWNOACTIVATE
                                style = GetWindowLong(hWnd, GWL_STYLE);
                            }

                            int neededStyle = style & ~WS_MAXIMIZEBOX & ~WS_MAXIMIZE & ~WS_MINIMIZEBOX;
                            if (style != neededStyle) {
                                SetWindowLong(hWnd, GWL_STYLE, neededStyle);
                                SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0, SWP_FLAGS_STYLE);
                            }
                        }
                    } catch {}

                    // 5. Bloquear e desabilitar do menu de sistema (clique direito na barra, miniatura e titulo)
                    try {
                        IntPtr hMenu = GetSystemMenu(hWnd, false);
                        if (hMenu != IntPtr.Zero) {
                            EnableMenuItem(hMenu, SC_MAXIMIZE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
                            EnableMenuItem(hMenu, SC_RESTORE,  MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
                            EnableMenuItem(hMenu, SC_MOVE,     MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
                            EnableMenuItem(hMenu, SC_SIZE,     MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
                            EnableMenuItem(hMenu, SC_MINIMIZE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);

                            DeleteMenu(hMenu, SC_MAXIMIZE, MF_BYCOMMAND);
                            DeleteMenu(hMenu, SC_RESTORE,  MF_BYCOMMAND);
                            DeleteMenu(hMenu, SC_MOVE,     MF_BYCOMMAND);
                            DeleteMenu(hMenu, SC_SIZE,     MF_BYCOMMAND);
                            DeleteMenu(hMenu, SC_MINIMIZE, MF_BYCOMMAND);
                        }
                    } catch {}

                    // 6. Forçar coordenadas offscreen (5000, 5000) se estiver visível na tela
                    RECT rect;
                    if (GetWindowRect(hWnd, out rect)) {
                        if (!IsIconic(hWnd) && (rect.Left < 3000 || rect.Top < 3000)) {
                            // Garantir que rcNormalPosition também está em 5000, 5000 para que nunca restaure na tela visível
                            WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
                            wp.length = Marshal.SizeOf(wp);
                            if (GetWindowPlacement(hWnd, ref wp)) {
                                wp.rcNormalPosition.Left = 5000;
                                wp.rcNormalPosition.Top = 5000;
                                wp.rcNormalPosition.Right = 6280;
                                wp.rcNormalPosition.Bottom = 5850;
                                SetWindowPlacement(hWnd, ref wp);
                            }
                            SetWindowPos(hWnd, IntPtr.Zero, 5000, 5000, 1280, 850, SWP_FLAGS_MOVE);
                        }
                    }
                    break;
                }
            }
            return true;
        }, IntPtr.Zero);
    }
}
'@

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

        # Actualizar lista de PIDs filhos a cada 15 iteracoes (~1.2s)
        if ($iter % 15 -eq 0) {
            $pids = @([uint32]$TargetPid)
            try {
                $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $TargetPid" -ErrorAction SilentlyContinue |
                            Select-Object -ExpandProperty ProcessId
                if ($children) {
                    foreach ($c in $children) { $pids += [uint32]$c }
                }
            } catch {}
            $cachedPids = $pids
        }
        $iter++

        [WindowKeeper]::GuardWindows($cachedPids)
        Start-Sleep -Milliseconds 80
    }
} catch {}
