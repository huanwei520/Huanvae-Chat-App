//! 会议内远程控制——被控端原生输入注入兜底（块 dstdrrek-2 新增）
//!
//! 跨端帧通道（frameChannel.ts）的被控端注入汇：0x06 InputEvent 优先回环转发
//! 本机 hv-control-daemon（块 A 标准件，armed 门禁在 daemon 侧）；daemon 不可达
//! 时经本命令落地（Windows：user32 SendInput/SetCursorPos FFI，std-only 零新依赖）。
//!
//! 语义对齐 daemon §7.2 mapping：事件为**状态快照**（x/y 屏幕绝对坐标；buttons
//! bit0 左/bit1 右/bit2 中；bit3 上滚/bit4 下滚（块 pz3oo1tp，瞬时事件不入快照）；
//! keys=按下键码集合快照）——本模块维护 held 差分：
//! 新按下的键/键发 down，快照里消失的发 up，指针位移 SetCursorPos。
//!
//! 键码域：前端 domKeyToKeysym 的 X11 keysym 低 16 位（coordinates.ts KEY_TABLE）
//! → Windows VK 映射（字母/数字恒等或 −0x20；功能键/修饰键查表）；表外键丢弃。

use serde::Deserialize;

/// 0x06 InputEvent 注入载荷（frameChannel.ts relayInjection 投递形态）。
/// allow(dead_code)：字段仅 Windows 兜底臂消费（非 Windows 平台编译期不可达）。
#[allow(dead_code)]
#[derive(Deserialize)]
pub struct RcInjectEvent {
    /// 屏幕绝对坐标 X（u16 域，daemon mapping 同域）
    pub x: u32,
    /// 屏幕绝对坐标 Y
    pub y: u32,
    /// buttons 位掩码：bit0 左 / bit1 右 / bit2 中 / bit3 上滚 / bit4 下滚（coordinates.ts 同域）
    pub buttons: u8,
    /// 按下键码集合快照（X11 keysym 低 16 位）
    #[serde(default)]
    pub keys: Vec<u16>,
}

#[cfg(target_os = "windows")]
mod imp {
    use super::RcInjectEvent;
    use std::sync::Mutex;

    // —— user32 FFI（std-only；INPUT/MOUSEINPUT/KEYBDINPUT 手工对齐 x64 ABI）——
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MouseInput {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        dw_flags: u32,
        time: u32,
        extra_info: usize,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeyboardInput {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        extra_info: usize,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    union InputUnion {
        mi: MouseInput,
        ki: KeyboardInput,
    }
    #[repr(C)]
    struct Input {
        r#type: u32,
        u: InputUnion,
    }

    unsafe extern "system" {
        fn SendInput(ncinputs: u32, pinputs: *const Input, cbsize: i32) -> u32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
    }

    const INPUT_MOUSE: u32 = 0;
    const INPUT_KEYBOARD: u32 = 1;
    const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
    const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
    const MOUSEEVENTF_RIGHTDOWN: u32 = 0x0008;
    const MOUSEEVENTF_RIGHTUP: u32 = 0x0010;
    const MOUSEEVENTF_MIDDLEDOWN: u32 = 0x0020;
    const MOUSEEVENTF_MIDDLEUP: u32 = 0x0040;
    const MOUSEEVENTF_WHEEL: u32 = 0x0800;
    /// Windows 滚轮一格的标准化增量（WINUSER/WHEEL_DELTA）
    const WHEEL_DELTA: i32 = 120;
    const KEYEVENTF_KEYUP: u32 = 0x0002;

    fn mouse_event(flags: u32) -> bool {
        let input = Input {
            r#type: INPUT_MOUSE,
            u: InputUnion {
                mi: MouseInput {
                    dx: 0,
                    dy: 0,
                    mouse_data: 0,
                    dw_flags: flags,
                    time: 0,
                    extra_info: 0,
                },
            },
        };
        unsafe { SendInput(1, &input, std::mem::size_of::<Input>() as i32) == 1 }
    }

    fn key_event(vk: u16, up: bool) -> bool {
        let input = Input {
            r#type: INPUT_KEYBOARD,
            u: InputUnion {
                ki: KeyboardInput {
                    w_vk: vk,
                    w_scan: 0,
                    dw_flags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    extra_info: 0,
                },
            },
        };
        unsafe { SendInput(1, &input, std::mem::size_of::<Input>() as i32) == 1 }
    }

    /// 滚轮瞬时事件（块 pz3oo1tp：delta>0 上滚 / <0 下滚；MOUSEEVENTF_WHEEL，
    /// mouse_data 携带 WHEEL_DELTA 标准化增量，负号表方向）
    #[allow(dead_code)]
    fn wheel_event(delta: i32) -> bool {
        let input = Input {
            r#type: INPUT_MOUSE,
            u: InputUnion {
                mi: MouseInput {
                    dx: 0,
                    dy: 0,
                    mouse_data: delta as u32,
                    dw_flags: MOUSEEVENTF_WHEEL,
                    time: 0,
                    extra_info: 0,
                },
            },
        };
        unsafe { SendInput(1, &input, std::mem::size_of::<Input>() as i32) == 1 }
    }

    /// keysym（coordinates.ts KEY_TABLE）→ Windows VK；表外 None（丢弃）
    fn keysym_to_vk(sym: u16) -> Option<u16> {
        match sym {
            // 字母：keysym 0x61..=0x7A（小写 ASCII）→ VK 0x41..=0x5A
            0x61..=0x7a => Some(sym - 0x20),
            // 数字恒等（0x30..=0x39）
            0x30..=0x39 => Some(sym),
            0x0020 => Some(0x20),           // space → VK_SPACE
            0xff08 => Some(0x08),           // Backspace → VK_BACK
            0xff09 => Some(0x09),           // Tab → VK_TAB
            0xff0d => Some(0x0d),           // Return → VK_RETURN
            0xff1b => Some(0x1b),           // Escape → VK_ESCAPE
            0xff51 => Some(0x25),           // ArrowLeft → VK_LEFT
            0xff52 => Some(0x26),           // ArrowUp
            0xff53 => Some(0x27),           // ArrowRight
            0xff54 => Some(0x28),           // ArrowDown
            0xffe1 | 0xffe2 => Some(0x10),  // Shift → VK_SHIFT
            0xffe3 | 0xffe4 | 0xffe5 => Some(0x11), // Control → VK_CONTROL
            0xffe9 | 0xffea | 0xffe7 | 0xffe8 => Some(0x12), // Alt → VK_MENU
            _ => None,
        }
    }

    /// held 差分态（App 生命周期内进程级；键鼠快照语义见模块文档）
    struct HeldState {
        buttons: u8,
        keys: Vec<u16>, // VK 域
    }
    fn held() -> &'static Mutex<HeldState> {
        static HELD: std::sync::OnceLock<Mutex<HeldState>> = std::sync::OnceLock::new();
        HELD.get_or_init(|| {
            Mutex::new(HeldState {
                buttons: 0,
                keys: Vec::new(),
            })
        })
    }

    pub fn inject(ev: &RcInjectEvent) -> Result<(), String> {
        // 1) 指针位移（屏幕绝对坐标）
        if unsafe { SetCursorPos(ev.x as i32, ev.y as i32) } == 0 {
            return Err("SetCursorPos failed".into());
        }
        let mut errors: usize = 0;
        let mut st = held().lock().map_err(|_| "held state poisoned")?;
        // 1.5) 滚轮瞬时事件（块 pz3oo1tp：bit3 上滚 / bit4 下滚——App ControlWindow
        //      onWheel 单发；瞬时语义不入 held 快照态，无按住/抬起配对）。
        //      注意：daemon 标准件（HuanvaeRemote mapping.rs）不认 bit3/4，Windows 上
        //      daemon 注入汇不可用（X11-only）⇒ 实际滚轮必经本臂落地。
        let wheel = if ev.buttons & 0x08 != 0 {
            Some(WHEEL_DELTA)
        } else if ev.buttons & 0x10 != 0 {
            Some(-WHEEL_DELTA)
        } else {
            None
        };
        if let Some(delta) = wheel {
            if !wheel_event(delta) {
                errors += 1;
            }
        }
        // 2) 按键差分（down：快照有而 held 无；up：held 有而快照无）
        for vk in ev.keys.iter().filter_map(|s| keysym_to_vk(*s)) {
            if !st.keys.contains(&vk) {
                if !key_event(vk, false) {
                    errors += 1;
                } else {
                    st.keys.push(vk);
                }
            }
        }
        st.keys.retain(|vk| {
            if ev.keys.iter().any(|s| keysym_to_vk(*s) == Some(*vk)) {
                true
            } else {
                if !key_event(*vk, true) {
                    errors += 1;
                }
                false
            }
        });
        // 3) 鼠标键差分（bit0 左 / bit1 右 / bit2 中；coordinates.ts 同域）
        let transitions: [(u8, u32, u32); 3] = [
            (0x01, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
            (0x02, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            (0x04, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        ];
        for (bit, down_flag, up_flag) in transitions {
            let want = ev.buttons & bit != 0;
            let have = st.buttons & bit != 0;
            if want && !have {
                if !mouse_event(down_flag) {
                    errors += 1;
                } else {
                    st.buttons |= bit;
                }
            } else if !want && have {
                if !mouse_event(up_flag) {
                    errors += 1;
                } else {
                    st.buttons &= !bit;
                }
            }
        }
        if errors > 0 {
            return Err(format!("SendInput 部分失败：{errors} 个事件未投递"));
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::RcInjectEvent;
    /// 非 Windows：无原生兜底（Linux 走 hv-control-daemon XTEST 标准件）。
    /// 如实报错让调用方计数，不假装成功。
    pub fn inject(_ev: &RcInjectEvent) -> Result<(), String> {
        Err("rc_inject_input 原生兜底仅在 Windows 实现；本机请部署 hv-control-daemon".into())
    }
}

/// 被控端原生注入兜底（frameChannel.ts relayInjection 第二臂）。
/// 返回 Ok("injected") = 全部事件投递成功；Err = 失败原因（调用方计数留痕）。
#[tauri::command]
pub fn rc_inject_input(event: RcInjectEvent) -> Result<String, String> {
    imp::inject(&event)?;
    Ok("injected".to_string())
}
