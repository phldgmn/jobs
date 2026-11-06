// Jobs menu bar app: runs the bundled server binary and offers
// Open Web UI / Settings / Quit. Personal use, no distribution.
import AppKit
import ServiceManagement
import Security

let bundleID = Bundle.main.bundleIdentifier ?? "eu.dgmn.jobsmenubar"
let serverPort = (Bundle.main.infoDictionary?["SERVER_PORT"] as? Int) ?? 3000
// Browser URL uses the name; the server itself still binds 127.0.0.1 only.
let serverURL = "http://jobs.localhost:\(serverPort)/"
// Per-user app state lives outside the repo so the installed app is self-contained.
let dataDir = try! FileManager.default
    .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    .appendingPathComponent(bundleID, isDirectory: true)

let keychainItem: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: bundleID,
    kSecAttrAccount as String: "OPENAI_API_KEY",
]

func readAPIKey() -> String? {
    var query = keychainItem
    query[kSecReturnData as String] = true
    var out: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
}

// Empty key deletes the item (keyless local servers like Ollama).
// Update first: delete can fail for items created by another signature, and a failed delete must not block the write.
func writeAPIKey(_ key: String) -> OSStatus {
    guard !key.isEmpty else {
        let status = SecItemDelete(keychainItem as CFDictionary)
        return status == errSecItemNotFound ? errSecSuccess : status
    }
    let value = [kSecValueData as String: Data(key.utf8)] as CFDictionary
    let status = SecItemUpdate(keychainItem as CFDictionary, value)
    guard status == errSecItemNotFound else { return status }
    var item = keychainItem
    item[kSecValueData as String] = Data(key.utf8)
    return SecItemAdd(item as CFDictionary, nil)
}

// SIGTERM (kill, logout, login-item removal): AppKit's default exit path
// does not notify the delegate, and DispatchSource swallows the signal
// without firing in this setup (verified by repro). Classic handler instead.
var serverPID: pid_t = -1
signal(SIGTERM) { _ in
    if serverPID > 0 { kill(serverPID, SIGTERM) }
    _exit(0)
}

// Single instance: a second launch exits immediately.
if NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).count > 1 {
    exit(0)
}

// Accessory apps have no visible main menu, but Cmd+V/C/X/A still resolve through NSApp.mainMenu key equivalents.
func installEditMenu() {
    let editItem = NSMenuItem()
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    let mainMenu = NSMenu()
    mainMenu.addItem(NSMenuItem())  // first item is the application menu; keep it empty so Edit is not taken for it
    mainMenu.addItem(editItem)
    NSApp.mainMenu = mainMenu
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var statusItem: NSStatusItem!
    var serverProcess: Process?

    func applicationDidFinishLaunching(_ note: Notification) {
        // Debug/testing entry point (menu item otherwise): `open /Applications/Jobs.app --args --login-item on|off`
        if let idx = CommandLine.arguments.firstIndex(of: "--login-item") {
            let arg = idx + 1 < CommandLine.arguments.count ? CommandLine.arguments[idx + 1] : ""
            try? (arg == "on" ? SMAppService.mainApp.register() : SMAppService.mainApp.unregister())
            exit(0)
        }
        installEditMenu()
        startServer()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "briefcase", accessibilityDescription: "Jobs")
            button.toolTip = "Jobs"
        }
        let menu = buildMenu()
        statusItem.menu = menu
        // First launch: nothing configured yet, so ask once. Cancel leaves defaults; the dialog stays reachable via the menu.
        if UserDefaults.standard.object(forKey: "baseURL") == nil && readAPIKey() == nil { showSettings() }
    }

    func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(withTitle: "Open Web UI", action: #selector(openWebUI), keyEquivalent: "")
        menu.addItem(withTitle: "Settings…", action: #selector(showSettings), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quit), keyEquivalent: "")
        for item in menu.items {
            item.target = self
        }
        return menu
    }

    @objc func openWebUI() {
        guard isServerUp() else {
            showError("Server not running", "Could not reach \(serverURL). Check ~/Library/Logs/jobs-menubar/server.log")
            return
        }
        NSWorkspace.shared.open(URL(string: serverURL)!)
    }

    @objc func showSettings() {
        let defaults = UserDefaults.standard
        let base = NSTextField(string: defaults.string(forKey: "baseURL") ?? "")
        base.placeholderString = "https://api.openai.com/v1"
        let key = NSSecureTextField(string: readAPIKey() ?? "")
        key.placeholderString = "Empty for keyless local servers"
        let model = NSTextField(string: defaults.string(forKey: "model") ?? "")
        model.placeholderString = "..."
        for field in [base, key, model] { field.widthAnchor.constraint(equalToConstant: 320).isActive = true }
        let startAtLogin = NSButton(checkboxWithTitle: "", target: nil, action: nil)
        startAtLogin.state = SMAppService.mainApp.status == .enabled ? .on : .off
        let grid = NSGridView(views: [
            [NSTextField(labelWithString: "API base URL"), base],
            [NSTextField(labelWithString: "API key"), key],
            [NSTextField(labelWithString: "Default model"), model],
            [NSTextField(labelWithString: "Start at login"), startAtLogin],
        ])
        grid.frame.size = grid.fittingSize

        let alert = NSAlert()
        alert.messageText = "Jobs settings"
        alert.informativeText = "OpenAI-compatible API. The key is stored in your Keychain. Saving restarts the server."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.accessoryView = grid
        alert.window.initialFirstResponder = base
        NSApp.activate(ignoringOtherApps: true)  // accessory app: otherwise the dialog opens behind other windows
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let baseValue = base.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if !baseValue.isEmpty, !["http", "https"].contains(URL(string: baseValue)?.scheme ?? "") {
            showError("Invalid base URL", "Base URL must start with http:// or https://")
            return
        }
        let status = writeAPIKey(key.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        guard status == errSecSuccess else {
            showError("Could not save API key", SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)")
            return
        }
        defaults.set(baseValue, forKey: "baseURL")
        defaults.set(model.stringValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "model")
        stopServer()
        startServer()
        setStartAtLogin(startAtLogin.state == .on)
    }

    func showError(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.runModal()
    }

    func setStartAtLogin(_ on: Bool) {
        guard on != (SMAppService.mainApp.status == .enabled) else { return }
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            showError("Could not change login item", error.localizedDescription)
        }
    }

    @objc func quit() {
        stopServer()
        NSApp.terminate(nil)
    }

    // MARK: - server process

    func isServerUp() -> Bool {
        // Poll connect for up to ~3 s.
        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline {
            if isReachable(port: serverPort) { return true }
            Thread.sleep(forTimeInterval: 0.2)
        }
        return false
    }

    func isReachable(port: Int) -> Bool {
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(port).bigEndian
        addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let sock = socket(AF_INET, SOCK_STREAM, 0)
        guard sock >= 0 else { return false }
        defer { close(sock) }
        let result = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }

    func startServer() {
        guard let serverURL = Bundle.main.url(forResource: "jobs-server", withExtension: nil) else {
            NSLog("Jobs: jobs-server resource missing from bundle")
            return
        }
        try? FileManager.default.createDirectory(
            atPath: FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Logs/jobs-menubar",
            withIntermediateDirectories: true)
        let logPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/jobs-menubar/server.log").path
        // Append to previous run's log; open one handle, share for out+err.
        FileManager.default.createFile(atPath: logPath, contents: nil)
        let logHandle = FileHandle(forWritingAtPath: logPath)
        logHandle?.seekToEndOfFile()

        let process = Process()
        process.executableURL = serverURL
        process.currentDirectoryURL = dataDir
        var env = ProcessInfo.processInfo.environment
        env["NODE_ENV"] = "production"
        env["PORT"] = String(serverPort)
        // Assigning nil removes any inherited value, so the server falls back to its defaults.
        let defaults = UserDefaults.standard
        env["DB_PATH"] = dataDir.appendingPathComponent("jobs.db").path
        env["OPENAI_BASE_URL"] = defaults.string(forKey: "baseURL").flatMap { $0.isEmpty ? nil : $0 }
        env["OPENAI_API_KEY"] = readAPIKey()
        env["LLM_MODEL"] = defaults.string(forKey: "model").flatMap { $0.isEmpty ? nil : $0 }
        process.environment = env
        process.standardOutput = logHandle
        process.standardError = logHandle
        process.standardInput = FileHandle.nullDevice
        do {
            try process.run()
            serverProcess = process
            serverPID = process.processIdentifier
            NSLog("Jobs: server started, pid \(process.processIdentifier)")
        } catch {
            NSLog("Jobs: failed to start server: \(error)")
        }
        logHandle?.closeFile()
    }

    func stopServer() {
        serverProcess?.terminate()
        serverProcess?.waitUntilExit()  // free the port before a restart binds it again
        serverProcess = nil
        serverPID = -1
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
