# Jobs menu bar app build. Server binary via bun, app bundle via swiftc,
# Safari web extension via xcodebuild (embedded as PlugIns/*.appex).
SHELL := /bin/sh
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
APPDIR := $(ROOT)/dist
APP := $(APPDIR)/Jobs.app
BUNDLE := $(APP)/Contents
SERVER_BIN := $(ROOT)/../bin/jobs-server
REPO := $(abspath $(ROOT)/..)
SAFARI_PROJ := $(REPO)/safari-extension/build/Jobs Capture
SAFARI_DD := $(ROOT)/../bin/safari-dd
APPEX := $(SAFARI_DD)/Build/Products/Release/Jobs Capture.app/Contents/PlugIns/Jobs Capture Extension.appex
# Must match the menu bar app's bundle ID: Safari derives the extension's parent from it.
APP_ID := eu.dgmn.jobsmenubar
TEAM_ID := T592P4FM4E
# Safari only loads extensions signed by a team; Apple Development identity from the Xcode project.
SIGN_ID ?= Apple Development
.PHONY: all server safari-project safari app install run clean
all: app

server:
	bun build --compile $(REPO)/src/server.ts --outfile $(SERVER_BIN)

# Generated Xcode project is gitignored. Converter's macOS app target gets a wrong default ID; sed corrects it (idempotent).
safari-project:
	test -d "$(SAFARI_PROJ)" || { \
	  xcrun safari-web-extension-converter $(REPO)/safari-extension/Extension --app-name "Jobs Capture" --bundle-identifier $(APP_ID) --project-location $(REPO)/safari-extension/build --macos-only --copy-resources --no-open --no-prompt --force; }
	sed -i '' 's/eu.dgmn.Jobs-Capture/$(APP_ID)/g' "$(SAFARI_PROJ)/Jobs Capture.xcodeproj/project.pbxproj"

safari: safari-project
	cp -R $(REPO)/safari-extension/Extension/. "$(SAFARI_PROJ)/Jobs Capture Extension/Resources/"
	cd "$(SAFARI_PROJ)" && xcodebuild -project "Jobs Capture.xcodeproj" -scheme "Jobs Capture" -configuration Release -derivedDataPath $(SAFARI_DD) DEVELOPMENT_TEAM=$(TEAM_ID) build

app: server safari
	rm -rf $(APP)
	mkdir -p $(BUNDLE)/MacOS $(BUNDLE)/Resources $(BUNDLE)/PlugIns
	swiftc -O $(ROOT)/main.swift -o $(BUNDLE)/MacOS/jobs-menubar
	sed 's|@REPO_PATH@|$(REPO)|' $(ROOT)/Info.plist.in > $(BUNDLE)/Info.plist
	cp $(SERVER_BIN) $(BUNDLE)/Resources/jobs-server
	cp $(ROOT)/AppIcon.icns $(BUNDLE)/Resources/AppIcon.icns
	cp -R "$(APPEX)" "$(BUNDLE)/PlugIns/"
	if security find-identity -v -p codesigning | grep -q "$(SIGN_ID)"; then \
	  codesign --force --preserve-metadata=entitlements --sign "$(SIGN_ID)" "$(BUNDLE)/PlugIns/Jobs Capture Extension.appex"; \
	  codesign --force --sign "$(SIGN_ID)" "$(APP)"; \
	else \
	  echo "warning: no $(SIGN_ID) identity, ad-hoc signing (Safari will not load the extension)"; \
	  codesign --force --sign - "$(APP)"; \
	fi
install: app
	rm -rf /Applications/Jobs.app
	cp -R $(APP) /Applications/
	open /Applications/Jobs.app
run: app
	open $(APP)
clean:
	rm -rf $(APPDIR) $(SERVER_BIN) $(SAFARI_DD)
