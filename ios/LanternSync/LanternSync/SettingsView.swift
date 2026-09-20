import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: SyncViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var password = ""
    @State private var isTesting = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Mac Mini") {
                    TextField("http://your-mac-mini.local:4173", text: $address)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Library password (optional)", text: $password)
                }
                Section {
                    Text("Use the Home network address printed when Lantern Photos starts. Keep http:// at the beginning.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Button {
                        isTesting = true
                        Task {
                            if await model.saveSettings(address: address, password: password) { dismiss() }
                            isTesting = false
                        }
                    } label: {
                        HStack {
                            if isTesting { ProgressView().padding(.trailing, 4) }
                            Text(isTesting ? "Connecting…" : "Save and test connection")
                        }
                    }
                    .disabled(isTesting || address.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .navigationTitle("Sync settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                address = model.serverAddress
                password = model.password
            }
        }
    }
}
