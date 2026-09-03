use std::cell::Cell;
use std::io::{IsTerminal, Write};

pub struct Report {
    tty: bool,
    last: Cell<u64>,
    width: Cell<usize>,
}

impl Report {
    fn new() -> Self {
        Self { tty: std::io::stdout().is_terminal(), last: Cell::new(u64::MAX), width: Cell::new(0) }
    }

    pub fn status(&self, text: impl Into<String>) {
        self.clear_line();
        println!("{}", text.into());
        let _ = std::io::stdout().flush();
        self.last.set(u64::MAX);
    }

    pub fn progress(&self, done: u64, total: Option<u64>) {
        let Some(total) = total.filter(|t| *t > 0) else {
            return;
        };
        let percent = done.saturating_mul(100) / total;
        // Redrawing on every chunk floods a log file and flickers a terminal;
        // whole percent steps are enough for both.
        let step = if self.tty { 1 } else { 10 };
        if self.last.get() != u64::MAX && percent < self.last.get().saturating_add(step) {
            return;
        }
        self.last.set(percent);
        let line = format!("  {}%  {:.1} из {:.1} МБ", percent, mib(done), mib(total));
        if self.tty {
            self.width.set(line.chars().count());
            print!("\r{}", line);
        } else {
            println!("{}", line);
        }
        let _ = std::io::stdout().flush();
    }

    fn clear_line(&self) {
        if self.tty && self.width.get() > 0 {
            print!("\r{}\r", " ".repeat(self.width.get()));
            self.width.set(0);
        }
    }
}

fn mib(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0)
}

/// Mirrors the Windows window: the job either finishes or reports why. There is
/// no way to close a console run halfway, so `None` never happens here.
pub fn run(job: impl FnOnce(&Report) -> Result<(), String>) -> Option<Result<(), String>> {
    println!("Millida Launcher — установка");
    let report = Report::new();
    let outcome = job(&report);
    report.clear_line();
    Some(outcome)
}

pub fn fail(text: &str) {
    eprintln!("\n{}", text);
    let _ = std::io::stderr().flush();
}
