const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js'

function loadLogoTexture(THREE) {
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(
            '/icons/PistachioLogo.svg',
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace
                texture.anisotropy = 4
                resolve(texture)
            },
            undefined,
            reject,
        )
    })
}

function addReededEdge(THREE, group, material) {
    const count = 112
    const geometry = new THREE.BoxGeometry(0.034, 0.095, 0.39)
    const reeds = new THREE.InstancedMesh(geometry, material, count)
    const helper = new THREE.Object3D()

    for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2
        const radius = 1.84
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
    group.rotation.set(-0.12, -0.48, 0.045)

    const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x6f9f64,
        metalness: 0.78,
        roughness: 0.26,
    })
    const faceMaterial = new THREE.MeshStandardMaterial({
        color: 0x86b878,
        metalness: 0.72,
        roughness: 0.2,
    })
    const rimMaterial = new THREE.MeshStandardMaterial({
        color: 0x9acb8d,
        metalness: 0.86,
        roughness: 0.14,
    })
    const edgeMaterial = new THREE.MeshStandardMaterial({
        color: 0x5d8754,
        metalness: 0.76,
        roughness: 0.3,
    })

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(1.8, 1.8, 0.34, 128, 1, false),
        bodyMaterial,
    )
    body.rotation.x = Math.PI / 2
    group.add(body)

    for (const side of [1, -1]) {
        const face = new THREE.Mesh(new THREE.CircleGeometry(1.76, 128), faceMaterial)
        face.position.z = side * 0.177
        if (side < 0) face.rotation.y = Math.PI
        group.add(face)

        const outerRim = new THREE.Mesh(
            new THREE.TorusGeometry(1.79, 0.052, 22, 160),
            rimMaterial,
        )
        outerRim.position.z = side * 0.205
        group.add(outerRim)

        const innerRim = new THREE.Mesh(
            new THREE.TorusGeometry(1.54, 0.018, 14, 128),
            rimMaterial,
        )
        innerRim.position.z = side * 0.208
        group.add(innerRim)

        const logo = new THREE.Mesh(
            new THREE.PlaneGeometry(1.98, 2.22),
            new THREE.MeshBasicMaterial({
                map: logoTexture,
                transparent: true,
                alphaTest: 0.01,
                side: THREE.DoubleSide,
                toneMapped: false,
            }),
        )
        logo.position.set(0, -0.015, side * 0.219)
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
    camera.position.set(0, 0, 6.35)

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x191919, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.22
    renderer.domElement.className = 'hero-coin-live'
    frame.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.42))

    const warm = new THREE.PointLight(0xffd16a, 48, 12, 2)
    const white = new THREE.PointLight(0xffffff, 34, 11, 2)
    scene.add(warm, white)

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

    let raf = 0
    let lastTime = performance.now()
    let firstFrameSent = false

    const animate = (now) => {
        const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000))
        lastTime = now

        coin.rotation.y += delta * 0.72
        coin.rotation.x = -0.12 + Math.sin(now / 2000) * 0.035
        coin.rotation.z = 0.045

        const seconds = now / 1000
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
        renderer.dispose()
        logoTexture.dispose()
        renderer.domElement.remove()
    }
}
