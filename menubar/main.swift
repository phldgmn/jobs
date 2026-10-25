// Jobs menu bar app: runs the bundled server binary and offers
// Open Web UI / Start at Login / Quit. Personal use, no distribution.
import AppKit
import ServiceManagement

let bundleID = Bundle.main.bundleIdentifier ?? "eu.dgmn.jobsmenubar"
let repoPath = Bundle.main.infoDictionary?["REPO_PATH"] as? String ?? FileManager.default.currentDirectoryPath
let serverPort = (Bundle.main.infoDictionary?["SERVER_PORT"] as? Int) ?? 3000
// Browser URL uses the name; the server itself still binds 127.0.0.1 only.
let serverURL = "http://jobs.localhost:\(serverPort)/"

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
        startServer()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "briefcase", accessibilityDescription: "Jobs")
            button.toolTip = "Jobs"
        }
        let menu = buildMenu()
        menu.delegate = self
        statusItem.menu = menu
    }

    // Refresh the checkmark each time the menu opens, since the login item can change outside the app.
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.items.first { $0.title == "Start at Login" }?.state =
            SMAppService.mainApp.status == .enabled ? .on : .off
    }

    func buildMenu() -> NSMenu {
        let menu = NSMenu()
        // Blank off-state image reserves the checkmark column, so text stays aligned when "Start at Login" is off.
        let blankState = NSImage(size: NSSize(width: 14, height: 14))
        menu.addItem(withTitle: "Open Web UI", action: #selector(openWebUI), keyEquivalent: "")
        let loginItem = NSMenuItem(title: "Start at Login", action: #selector(toggleStartAtLogin), keyEquivalent: "")
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(loginItem)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quit), keyEquivalent: "")
        for item in menu.items {
            item.target = self
            item.offStateImage = blankState
        }
        return menu
    }

    @objc func openWebUI() {
        guard isServerUp() else {
            let alert = NSAlert()
            alert.messageText = "Server not running"
            alert.informativeText = "Could not reach \(serverURL). Check ~/Library/Logs/jobs-menubar/server.log"
            alert.runModal()
            return
        }
        NSWorkspace.shared.open(URL(string: serverURL)!)
    }

    @objc func toggleStartAtLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Could not change login item"
            alert.informativeText = error.localizedDescription
            alert.runModal()
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
        process.currentDirectoryURL = URL(fileURLWithPath: repoPath)
        var env = ProcessInfo.processInfo.environment
        env["NODE_ENV"] = "production"
        env["PORT"] = String(serverPort)
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
        serverProcess = nil
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
