// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{MenuBuilder, SubmenuBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Build a minimal menu that won't steal keyboard shortcuts from the webview.
            // We only keep the macOS app menu (About/Hide/Quit) and a bare Window submenu.
            // No Edit menu -- that would intercept Cmd+Z, Cmd+C, etc. before Excalidraw sees them.
            // No Cmd+S binding -- Excalidraw handles save itself.
            let mut menu_builder = MenuBuilder::new(app);

            #[cfg(target_os = "macos")]
            {
                let app_menu = SubmenuBuilder::new(app, "Excalidraw")
                    .about(None)
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;
                menu_builder = menu_builder.item(&app_menu);
            }

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;
            menu_builder = menu_builder.item(&window_menu);

            let menu = menu_builder.build()?;
            app.set_menu(menu)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
