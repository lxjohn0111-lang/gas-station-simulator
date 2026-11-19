# Credits & third-party assets

Everything not listed here was made for this project and is generated procedurally. That
covers the textures (`scripts/gen_textures.py`), cars, buildings, props, sky, signage, sounds
and music.

## Libraries

- [three.js](https://threejs.org) (MIT)
- [cannon-es](https://github.com/pmndrs/cannon-es) (MIT)
- [gltf-transform](https://gltf-transform.dev) (MIT), used at build time to optimise models

## 3D models (`public/assets/models`)

| File | Source | Licence / notes |
| --- | --- | --- |
| `michelle.glb` | three.js examples (`Michelle.glb`), Adobe **Mixamo** character | Mixamo characters and animations are royalty-free for personal and commercial projects when used inside a game; they may not be redistributed as standalone assets. |
| `biker.glb` | three.js examples (`Soldier.glb`, "Vanguard"), Adobe **Mixamo** | As above |
| `anims.glb` | three.js examples (`Xbot.glb`), Adobe **Mixamo**; used for its animation clips | As above |
| `cowboy.glb` | three.js examples (`readyplayer.me.glb`), a **Ready Player Me** avatar | Check the Ready Player Me terms before a commercial release, or swap in your own avatar (any Mixamo-compatible rig works, because animations are retargeted at load). |
| `fox.glb` | Khronos [glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox) | Model by **PixelMannen** (CC0); rigging & animation by **@tomkranis** ([CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)); conversion by @AsoboStudio and @scurest. |

### Swapping characters

Any humanoid with Mixamo-style bone names (`mixamorig:Hips`, or plain `Hips`, …) works.
Drop a GLB into `public/assets/models/`, register it in `CharacterLibrary.load()`
(`src/entities/characters.js`), and the idle/walk/run/dance animations are retargeted to it
automatically.

## Inspiration

The game is an original take on the gas-station-simulator genre. All names, brands, layouts,
characters and art in it are original or credited above.
