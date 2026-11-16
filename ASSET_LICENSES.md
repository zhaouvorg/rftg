# Source and asset attribution

This local client imports card data and artwork from the sibling `RFTG` source tree. Rebuild the generated assets with `node scripts/import-assets.mjs` (or `--source /path/to/RFTG`). Hashes and counts are recorded in `public/data/provenance.json`.

- Tabletop game design: **Tom Lehmann**. Publisher and card/artwork copyright: **Rio Grande Games**.
- Original computer program: **Keldon Jones**. Contributions by **B. Nordli** and **J.-R. Reinhard**; later maintenance and development by **Archangel**.
- Card data, protocol conventions, and the deck-order translation follow `RFTG/src/cards.txt`, `init.c`, `rftg.h`, and their GPL version 2-or-later notices. The original GPL text is preserved in `LICENSE.assets-code`.
- Card faces, card backs, goal tiles, phase cards and icons are extracted byte-for-byte from `RFTG/src/images.data`.
- Orb, Invasion and Counterstrike components are copied from `RFTG/assets/orb`, `assets/xeno` and `assets/xcs`.

The software GPL grant does not itself relicense the game artwork or marks. Those retain their original rights and terms; this import is not a new artwork license. See the source project's `legal/NOTICE.txt`, `legal/LICENSE_SCOPE.md`, and `legal/MODIFICATIONS_AND_ATTRIBUTION.md` for its notices.

The import uses only local files and standard Node APIs. It does not compile or embed the original native client, and it does not use WebAssembly.
