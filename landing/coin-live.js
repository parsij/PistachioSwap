const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js'

const IS_IOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const MAX_DPR = IS_IOS ? 1.15 : 1.6
const ROTATION_DURATION_SECONDS = 6.4
const ROTATION_SPEED = (Math.PI * 2) / ROTATION_DURATION_SECONDS

function loadLogoTexture(THREE) {
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(
            '/icons/PistachioLogo.svg',
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace
                texture.anisotropy = IS_IOS ? 2 : 4
                resolve(texture)
            },
            undefined,
            reject,
        )
    })
}

function addReededEdge(THREE, group, material) {
    const count = IS_IOS ? 72 : 80
    const geometry = new THREE.BoxGeometry(0.03, 0.085, 0.34)
    const reeds = new THREE.InstancedMesh(geometry, material, count)
    const helper = new THREE.Object3D()

    for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2
        const radius = 1.78
        helper.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
        helper.rotation.set(0, 0, angle)
        helper.updateMatrix()
        reeds.setMatrixAt(index, helper.matrix)
    }

    reeds.instanceMatrix.needsUpdate = true
    group.add(reeds)
}

function createCoin(THREE, logoTexture) {
    const group = new THREE.Group()
    group.scale.setScalar(0.5)
    group.rotation.set(-0.1, -0.52, 0.04)

    const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x4f7a49,
        metalness: 0.72,
        roughness: 0.34,
    })

    const faceMaterial = new THREE.MeshStandardMaterial({
        color: 0x20251f,
        metalness: 0.18,
        roughness: 0.78,
    })

    const ringMaterial = new THREE.MeshStandardMaterial({
        color: 0xc8de8a,
        metalness: 0.64,
        roughness: 0.28,
    })

    const edgeMaterial = new THREE.MeshStandardMaterial({
        color: 0x41663c,
        metalness: 0.7,
        roughness: 0.36,
    })

    const logoBackingMaterial = new THREE.MeshStandardMaterial({
        color: 0x2d372a,
        metalness: 0.12,
        roughness: 0.86,
    })

    const logoMaterial = new THREE.MeshStandardMaterial({
        map: logoTexture,
        transparent: true,
        alphaTest: 0.04,
        side: THREE.DoubleSide,
        metalness: 0.03,
        roughness: 0.9,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    })

    const radialSegments = IS_IOS ? 72 : 96

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(1.74, 1.74, 0.32, radialSegments, 1, false),
        bodyMaterial,
    )
    body.rotation.x = Math.PI / 2
    group.add(body)

    for (const side of [1, -1]) {
        const face = new THREE.Mesh(
            new THREE.CircleGeometry(1.68, radialSegments),
            faceMaterial,
        )
        face.position.z = side * 0.164
        if (side < 0) face.rotation.y = Math.PI
        group.add(face)

        const outerRim = new THREE.Mesh(
            new THREE.TorusGeometry(1.7, 0.05, IS_IOS ? 12 : 18, IS_IOS ? 80 : 120),
            ringMaterial,
        )
        outerRim.position.z = side * 0.178
        group.add(outerRim)

        const innerRim = new THREE.Mesh(
            new THREE.TorusGeometry(1.44, 0.016, 10, IS_IOS ? 64 : 96),
            ringMaterial,
        )
        innerRim.position.z = side * 0.18
        group.add(innerRim)

        const logoBacking = new THREE.Mesh(
            new THREE.CircleGeometry(0.98, IS_IOS ? 56 : 72),
            logoBackingMaterial,
        )
        logoBacking.position.z = side * 0.181
        if (side < 0) logoBacking.rotation.y = Math.PI
        group.add(logoBacking)

        const logo = new THREE.Mesh(
            new THREE.PlaneGeometry(1.8, 2.02),
            logoMaterial,
        )
        logo.position.set(0, -0.01, side * 0.186)
        if (side < 0) logo.rotation.y = Math.PI
        group.add(logo)
    }

    addReededEdge(THREE, group, edgeMaterial)
    return group
}

export async function mountLiveCoin(frame, { onFirstFrame } = {}) {
    const THREE = await import(/* @vite-ignore */ THREE_URL)
    const logoTexture = await loadLogoTexture(THREE)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50)
    camera.position.set(0, 0, 6.2)

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
    })

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR))
    renderer.setClearColor(0x191919, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.domElement.className = 'hero-coin-live'
    frame.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xf4f9df, 0x10130f, 1.1))

    const key = new THREE.PointLight(0xf7ffcf, 28, 12, 2)
    const rim = new THREE.PointLight(0x8fdc62, 18, 12, 2)
    const fill = new THREE.PointLight(0xffffff, 12, 12, 2)
    scene.add(key, rim, fill)

    const coin = createCoin(THREE, logoTexture)
    scene.add(coin)

    let width = 0
    let height = 0

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

        coin.rotation.y += delta * ROTATION_SPEED
        coin.rotation.x = -0.1 + Math.sin(seconds * 0.7) * 0.018
        coin.rotation.z = 0.04

        key.position.set(
            Math.cos(seconds * 0.9) * 4.3,
            1.25 + Math.sin(seconds * 0.55) * 0.7,
            3.6 + Math.sin(seconds * 0.8) * 0.8,
        )

        rim.position.set(
            Math.cos(seconds * 0.7 + Math.PI) * 4.0,
            -1.0 + Math.sin(seconds * 0.6) * 0.8,
            3.1 + Math.cos(seconds * 0.6) * 0.6,
        )

        fill.position.set(0, 0.2, 4.2)

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
        renderer.dispose()
        logoTexture.dispose()
        renderer.domElement.remove()
    }
}
