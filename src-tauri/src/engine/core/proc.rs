// Hides the black console window when child processes start on Windows. Nothing else.
use std::process::Command;

/// On Windows every `Command::new` pops up a console window without
/// CREATE_NO_WINDOW.
pub(crate) fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
