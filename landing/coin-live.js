const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js'

const IS_IOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const QUALITY_PRESETS = {
    low: {
        dpr: 1,
        curveSegments: 64,
        torusSegments: 64,
        torusRadialSegments: 12,
        reeds: 64,
        logoFillLayers: 6,
        environmentSize: 128,
    },
    medium: {
        dpr: 1.5,
        curveSegments: 112,
        torusSegments: 112,
        torusRadialSegments: 18,
        reeds: 96,
        logoFillLayers: 10,
        environmentSize: 256,
    },
    high: {
        dpr: 2.25,
        curveSegments: 192,
        torusSegments: 192,
        torusRadialSegments: 24,
        reeds: 132,
        logoFillLayers: 16,
        environmentSize: 512,
    },
    ultra: {
        dpr: 3,
        curveSegments: 320,
        torusSegments: 320,
        torusRadialSegments: 32,
        reeds: 180,
        logoFillLayers: 24,
        environmentSize: 1024,
    },
}

const QUALITY_NAMES = ['low', 'medium', 'high', 'ultra']
const ROTATION_DURATION_SECONDS = 8.73
const ROTATION_SPEED = (Math.PI * 2) / ROTATION_DURATION_SECONDS
const COIN_DEPTH = 0.34
const FACE_Z = COIN_DEPTH / 2 + 0.061
const LOGO_RAISE = 0.07

function isHighEndIOS() {
    if (!IS_IOS) return false

    const dpr = window.devicePixelRatio || 1
    const cores = navigator.hardwareConcurrency || 6
    const longSide = Math.max(window.screen?.width || 0, window.screen?.height || 0)
    const physicalLongSide = longSide * dpr

    return dpr >= 3 && cores >= 6 && physicalLongSide >= 2550
}

function defaultQualityName() {
    if (isHighEndIOS()) return 'ultra'
    if (IS_IOS) return 'high'

    const dpr = window.devicePixelRatio || 1
    const cores = navigator.hardwareConcurrency || 8
    if (dpr >= 2.5 && cores >= 8) return 'ultra'
    return 'high'
}

function loadLogoTexture(THREE, renderer) {
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(
            '/icons/PistachioLogo.svg',
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace
                texture.minFilter = THREE.LinearMipmapLinearFilter
                texture.magFilter = THREE.LinearFilter
                texture.generateMipmaps = true
                texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy())
                texture.needsUpdate = true
                resolve(texture)
            },
            undefined,
            reject,
        )
    })
}

function disposeObject(object) {
    object.traverse((child) => {
        child.geometry?.dispose?.()
        if (Array.isArray(child.material)) {
            child.material.forEach((material) => material?.dispose?.())
        } else {
            child.material?.dispose?.()
        }
    })
}

function addReededEdge(THREE, group, material, reeds) {
    const geometry = new THREE.BoxGeometry(0.034, 0.095, COIN_DEPTH * 1.16)
    const mesh = new THREE.InstancedMesh(geometry, material, reeds)
    const helper = new THREE.Object3D()

    for (let index = 0; index < reeds; index += 1) {
        const angle = (index / reeds) * Math.PI * 2
        const radius = 2.022
        helper.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
        helper.rotation.set(0, 0, angle)
        helper.updateMatrix()
        mesh.setMatrixAt(index, helper.matrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
}

function metalMaterial(THREE, color, overrides = {}) {
    return new THREE.MeshPhysicalMaterial({
        color,
        metalness: 1,
        roughness: 0.17,
        clearcoat: 0.18,
        clearcoatRoughness: 0.13,
        envMapIntensity: 2.55,
        ...overrides,
    })
}

function createLogoMaterial(THREE, logoTexture, sideWall = false) {
    return new THREE.MeshPhysicalMaterial({
        map: logoTexture,
        color: sideWall ? 0xb8b8b8 : 0xffffff,
        metalness: 0,
        roughness: sideWall ? 0.42 : 0.35,
        clearcoat: sideWall ? 0.04 : 0.12,
        clearcoatRoughness: 0.2,
        envMapIntensity: sideWall ? 0.7 : 1.1,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: true,
        toneMapped: false,
        side: THREE.DoubleSide,
    })
}

function createCoin(THREE, logoTexture, config) {
    const group = new THREE.Group()
    group.scale.setScalar(0.5)
    group.rotation.set(-0.12, -0.48, 0.045)

    const bodyMaterial = metalMaterial(THREE, 0x6da866)
    const faceMaterial = metalMaterial(THREE, 0x86bd7f, {
        roughness: 0.205,
        clearcoat: 0.14,
        envMapIntensity: 2.2,
    })
    const outerRimMaterial = metalMaterial(THREE, 0xa4d39d, {
        roughness: 0.105,
        envMapIntensity: 3,
    })
    const innerRimMaterial = metalMaterial(THREE, 0x4f814a, {
        roughness: 0.24,
    })
    const edgeMaterial = metalMaterial(THREE, 0x3f6c3a, {
        roughness: 0.27,
        envMapIntensity: 2.1,
    })

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(2, 2, COIN_DEPTH, config.curveSegments, 1, false),
        bodyMaterial,
    )
    body.rotation.x = Math.PI / 2
    group.add(body)

    for (const side of [1, -1]) {
        const faceGroup = new THREE.Group()
        faceGroup.position.z = side * FACE_Z
        if (side < 0) faceGroup.rotation.y = Math.PI

        const face = new THREE.Mesh(
            new THREE.CircleGeometry(1.79, config.curveSegments),
            faceMaterial.clone(),
        )
        faceGroup.add(face)

        const outerRim = new THREE.Mesh(
            new THREE.TorusGeometry(
                1.82,
                0.055,
                config.torusRadialSegments,
                config.torusSegments,
            ),
            outerRimMaterial.clone(),
        )
        faceGroup.add(outerRim)

        const innerRim = new THREE.Mesh(
            new THREE.TorusGeometry(
                1.55,
                0.018,
                Math.max(8, Math.floor(config.torusRadialSegments * 0.7)),
                config.torusSegments,
            ),
            innerRimMaterial.clone(),
        )
        faceGroup.add(innerRim)

        for (let index = 0; index < config.logoFillLayers; index += 1) {
            const progress = (index + 1) / (config.logoFillLayers + 1)
            const logoLayer = new THREE.Mesh(
                new THREE.PlaneGeometry(1.98, 2.22),
                createLogoMaterial(THREE, logoTexture, true),
            )
            logoLayer.position.set(0, -0.015, 0.012 + LOGO_RAISE * progress)
            logoLayer.renderOrder = 3 + index / 100
            faceGroup.add(logoLayer)
        }

        const logo = new THREE.Mesh(
            new THREE.PlaneGeometry(1.98, 2.22),
            createLogoMaterial(THREE, logoTexture, false),
        )
        logo.position.set(0, -0.015, 0.012 + LOGO_RAISE)
        logo.renderOrder = 5
        faceGroup.add(logo)

        group.add(faceGroup)
    }

    addReededEdge(THREE, group, edgeMaterial, config.reeds)
    return group
}

function createStudioEnvironment(THREE, renderer, size) {
    const environmentScene = new THREE.Scene()
    environmentScene.background = new THREE.Color(0x080a08)

    const room = new THREE.Mesh(
        new THREE.BoxGeometry(30, 30, 30),
        new THREE.MeshBasicMaterial({
            color: 0x101310,
            side: THREE.BackSide,
            toneMapped: false,
        }),
    )
    environmentScene.add(room)

    const addPanel = (color, position, scale) => {
        const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(scale[0], scale[1]),
            new THREE.MeshBasicMaterial({
                color,
                side: THREE.DoubleSide,
                toneMapped: false,
            }),
        )
        panel.position.set(...position)
        panel.lookAt(0, 0, 0)
        environmentScene.add(panel)
    }

    addPanel(0xfff2c9, [-4, 2.5, 4], [3, 7])
    addPanel(0xffffff, [4.5, 0.5, 3], [2, 6])
    addPanel(0xffba3c, [0, -4, 2], [7, 2])
    addPanel(0xe7ffd9, [0, 4.4, -2.8], [5, 1.4])

    const target = new THREE.WebGLCubeRenderTarget(size, {
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
    })
    const cubeCamera = new THREE.CubeCamera(0.1, 100, target)
    cubeCamera.update(renderer, environmentScene)

    disposeObject(environmentScene)
    return target
}

export async function mountLiveCoin(frame, { onFirstFrame, quality = 'auto' } = {}) {
    const THREE = await import(/* @vite-ignore */ THREE_URL)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50)
    camera.position.set(0, 0, 6.35)

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        premultipliedAlpha: true,
        powerPreference: 'high-performance',
    })
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.26
    renderer.domElement.className = 'hero-coin-live'
    frame.appendChild(renderer.domElement)

    const logoTexture = await loadLogoTexture(THREE, renderer)

    scene.add(new THREE.AmbientLight(0xffffff, 0.055))
    const warm = new THREE.PointLight(0xffd16a, 58, 12, 2)
    const white = new THREE.PointLight(0xffffff, 42, 11, 2)
    scene.add(warm, white)

    let width = 0
    let height = 0
    let coin = null
    let environmentTarget = null
    let qualityName = 'high'
    let autoMode = quality === 'auto'

    const resize = () => {
        const nextWidth = Math.max(1, frame.clientWidth)
        const nextHeight = Math.max(1, frame.clientHeight)
        if (nextWidth === width && nextHeight === height) return

        width = nextWidth
        height = nextHeight
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height, false)
    }

    const applyQuality = (requested) => {
        const normalized = String(requested).trim().toLowerCase()
        const nextName = normalized === 'auto' ? defaultQualityName() : normalized
        const preset = QUALITY_PRESETS[nextName]

        if (!preset) {
            console.warn('[pistachio-swap] coin quality must be low, medium, high, ultra, or auto')
            return null
        }

        autoMode = normalized === 'auto'
        qualityName = nextName
        frame.dataset.liveQuality = qualityName

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.dpr))
        resize()

        if (coin) {
            scene.remove(coin)
            disposeObject(coin)
        }
        coin = createCoin(THREE, logoTexture, preset)
        scene.add(coin)

        if (environmentTarget) environmentTarget.dispose()
        environmentTarget = createStudioEnvironment(THREE, renderer, preset.environmentSize)
        scene.environment = environmentTarget.texture

        console.info(`[pistachio-swap] live coin quality: ${qualityName}`)
        return qualityName
    }

    window.coinQuality = {
        set: applyQuality,
        get: () => ({
            mode: autoMode ? 'auto' : 'manual',
            quality: qualityName,
            dpr: renderer.getPixelRatio(),
            deviceDpr: window.devicePixelRatio || 1,
            highEndIOS: isHighEndIOS(),
            environmentSize: QUALITY_PRESETS[qualityName].environmentSize,
        }),
        low: () => applyQuality('low'),
        medium: () => applyQuality('medium'),
        high: () => applyQuality('high'),
        ultra: () => applyQuality('ultra'),
        auto: () => applyQuality('auto'),
        levels: ['low', 'medium', 'high', 'ultra', 'auto'],
    }

    applyQuality(quality)
    resize()

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(frame)

    let firstFrameSent = false
    let raf = 0
    let lastTime = performance.now()

    const animate = (now) => {
        const delta = Math.min(0.033, Math.max(0, (now - lastTime) / 1000))
        lastTime = now
        const seconds = now / 1000

        if (coin) {
            coin.rotation.y += delta * ROTATION_SPEED
            coin.rotation.x = -0.12 + Math.sin(seconds * 0.5) * 0.035
            coin.rotation.z = 0.045
        }

        warm.position.set(
            Math.cos(seconds * 0.72) * 4.7,
            1.4 + Math.sin(seconds * 0.52) * 1.1,
            3.7 + Math.sin(seconds * 0.72) * 1.4,
        )
        white.position.set(
            Math.cos(seconds * 0.48 + Math.PI) * 4.2,
            -1.1 + Math.sin(seconds * 0.61) * 1.5,
            3.2 + Math.cos(seconds * 0.48) * 1.2,
        )

        renderer.render(scene, camera)

        if (!firstFrameSent) {
            firstFrameSent = true
            onFirstFrame?.(renderer.domElement)
        }

        raf = requestAnimationFrame(animate)
    }

    raf = requestAnimationFrame(animate)

    return () => {
        cancelAnimationFrame(raf)
        resizeObserver.disconnect()
        if (window.coinQuality?.get?.().quality === qualityName) delete window.coinQuality
        if (coin) disposeObject(coin)
        environmentTarget?.dispose()
        logoTexture.dispose()
        renderer.dispose()
        renderer.domElement.remove()
    }
}
