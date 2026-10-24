# Model Management — layer rules

The chat-model data model: providers, configured models, per-backend
model selection, and the transient catalog types used during setup.

## Architecture in one paragraph

The catalog is generated from the locked Pi SDK public built-in catalog and ships
with the plugin. It never downloads, caches, or refreshes model lists. The settings
UI can select built-in models or accept manually entered model IDs. Provider setup,
editing, and saving are local operations; only the explicit model-card test sends
inference requests. Each BYOK provider has configured models with a `ModelInfo`
snapshot, so runtime behavior comes from saved configuration and the bundled SDK
capability facts. Credentials remain in Keychain.
