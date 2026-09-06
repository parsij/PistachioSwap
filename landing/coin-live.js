import * as THREE from 'three'

const IS_IOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const MAX_DPR = IS_IOS ? 1.15 : 1.5
const ROTATION_SPEED = (Math.PI * 2) / 7.2

function loadLogoTexture() {
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

function createMaterials(logoTexture) {
    return {
        edge: new THREE.MeshPhysicalMaterial({
            color: 0x4f7e48,
            metalness: 0.84,
            roughness: 0.24,
            clearcoat: 0.7,
            clearcoatRoughness: 0.2,
        }),
        face: new THREE.MeshPhysicalMaterial({
            color: 0x182417,
            metalness: 0.34,
            roughness: 0.5,
            clearcoat: 0.52,
            clearcoatRoughness: 0.3,
        }),
        gold: new THREE.MeshPhysicalMaterial({
            color: 0xd7eda0,
            metalness: 0.78,
            roughness: 0.2,
            clearcoat: 0.78,
            clearcoatRoughness: 0.16,
        }),
        accent: new THREE.MeshPhysicalMaterial({
            color: 0x91d178,
            metalness: 0.48,
            roughness: 0.28,
            clearcoat: 0.72,
            clearcoatRoughness: 0.18,
        }),
        logoBacking: new THREE.MeshStandardMaterial({
            color: 0x273b24,
            metalness: 0.18,
            roughness: 0.62,
        }),
        logo: new THREE.MeshStandardMaterial({
            map: logoTexture,
            transparent: true,
            alphaTest: 0.04,
            side: THREE.DoubleSide,
            metalness: 0.05,
            roughness: 0.68,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        }),
    }
}

function addReededEdge(group, material) {
    const count = IS_IOS ? 64 : 84
    const geometry = new THREE.BoxGeometry(0.035, 0.09, 0.36)
    const reeds = new THREE.InstancedMesh(geometry, material, count)
    const helper = new THREE.Object3D()

    for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2
        helper.position.set(Math.cos(angle) * 1.78, Math.sin(angle) * 1.78, 0)
        helper.rotation.set(0, 0, angle)
        helper.updateMatrix()
        reeds.setMatrixAt(index, helper.matrix)
    }

    reeds.instanceMatrix.needsUpdate = true
    group.add(reeds)
}

function addCoinFace(group, side, materials, radialSegments) {
    const facingBack = side < 0

    const face = new THREE.Mesh(
        new THREE.CircleGeometry(1.68, radialSegments),
        materials.face,
    )
    face.position.z = side * 0.168
    if (facingBack) face.rotation.y = Math.PI
    group.add(face)

    const rings = [
        { radius: 1.69, tube: 0.052, material: materials.gold },
        { radius: 1.51, tube: 0.018, material: materials.accent },
        { radius: 1.39, tube: 0.012, material: materials.gold },
    ]

    rings.forEach(({ radius, tube, material }) => {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius, tube, IS_IOS ? 10 : 16, radialSegments),
            material,
        )
        ring.position.z = side * 0.182
        group.add(ring)
    })

    const logoBacking = new THREE.Mesh(
        new THREE.CircleGeometry(1.03, radialSegments),
        materials.logoBacking,
    )
    logoBacking.position.z = side * 0.183
    if (facingBack) logoBacking.rotation.y = Math.PI
    group.add(logoBacking)

    const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.84, 2.08), materials.logo)
    logo.position.set(0, -0.01, side * 0.19)
    if (facingBack) logo.rotation.y = Math.PI
    group.add(logo)
}

function createCoin(logoTexture) {
    const group = new THREE.Group()
    const materials = createMaterials(logoTexture)
    const radialSegments = IS_IOS ? 64 : 88

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(1.74, 1.74, 0.34, radialSegments, 1, false),
        materials.edge,
    )
    body.rotation.x = Math.PI / 2
    group.add(body)

    addCoinFace(group, 1, materials, radialSegments)
    addCoinFace(group, -1, materials, radialSegments)
    addReededEdge(group, materials.edge)

    group.scale.setScalar(0.56)
    group.rotation.set(-0.1, -0.54, 0.035)
    group.userData.materials = Object.values(materials)
    return group
}

function addLights(scene) {
    scene.add(new THREE.HemisphereLight(0xf4f9df, 0x0d140c, 1.15))

    const key = new THREE.PointLight(0xf5ffd0, 31, 13, 2)
    key.position.set(3.8, 2.7, 4.2)

    const rim = new THREE.PointLight(0x83dd6b, 23, 12, 2)
    rim.position.set(-3.8, -1.4, 3.4)

    const warm = new THREE.PointLight(0xf1d46b, 14, 10, 2)
    warm.position.set(0.2, -3.2, 2.8)

    scene.add(key, rim, warm)
    return { key, rim }
}

export async function mountLiveCoin(frame, { animate = true, onFirstFrame } = {}) {
    const logoTexture = await loadLogoTexture()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 50)
    camera.position.set(0, 0, 6.2)

    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        premultipliedAlpha: true,
    })

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    renderer.domElement.className = 'hero-coin-live'
    frame.appendChild(renderer.domElement)

    const { key, rim } = addLights(scene)
    const coin = createCoin(logoTexture)
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

    let raf = 0
    let firstFrameSent = false
    let inViewport = true
    const render = (seconds = 0) => {
        if (animate) {
            coin.rotation.y = -0.54 + seconds * ROTATION_SPEED
            coin.rotation.x = -0.1 + Math.sin(seconds * 0.72) * 0.025
            coin.position.y = Math.sin(seconds * 0.82) * 0.055
            key.position.x = Math.cos(seconds * 0.54) * 4.1
            rim.position.x = Math.cos(seconds * 0.47 + Math.PI) * 3.9
        }

        renderer.render(scene, camera)
        if (!firstFrameSent) {
            firstFrameSent = true
            onFirstFrame?.(renderer.domElement)
        }
    }

    const tick = (now) => {
        if (inViewport && !document.hidden) render(now / 1000)
        raf = requestAnimationFrame(tick)
    }

    let intersectionObserver
    if ('IntersectionObserver' in window) {
        intersectionObserver = new IntersectionObserver(([entry]) => {
            inViewport = entry?.isIntersecting ?? true
        }, { rootMargin: '120px' })
        intersectionObserver.observe(frame)
    }

    if (animate) raf = requestAnimationFrame(tick)
    else render()

    return () => {
        cancelAnimationFrame(raf)
        resizeObserver.disconnect()
        intersectionObserver?.disconnect()
        coin.traverse((object) => object.geometry?.dispose())
        coin.userData.materials.forEach((material) => material.dispose())
        logoTexture.dispose()
        renderer.dispose()
        renderer.domElement.remove()
    }
}
