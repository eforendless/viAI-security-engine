import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

function createLogoShape(image: HTMLImageElement) {
  const resolution = 192;
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, resolution, resolution);
  const { data } = context.getImageData(0, 0, resolution, resolution);
  const leftEdge: THREE.Vector2[] = [];
  const rightEdge: THREE.Vector2[] = [];

  for (let y = 0; y < resolution; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < resolution; x += 1) {
      if (data[(y * resolution + x) * 4 + 3] > 24) {
        if (left === -1) left = x;
        right = x;
      }
    }
    if (left === -1) continue;
    const normalizedY = 0.77 - ((y + 0.5) / resolution) * 1.54;
    leftEdge.push(new THREE.Vector2(-0.77 + ((left + 0.5) / resolution) * 1.54, normalizedY));
    rightEdge.push(new THREE.Vector2(-0.77 + ((right + 0.5) / resolution) * 1.54, normalizedY));
  }

  if (leftEdge.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(leftEdge[0].x, leftEdge[0].y);
  for (let index = 1; index < leftEdge.length; index += 1) shape.lineTo(leftEdge[index].x, leftEdge[index].y);
  for (let index = rightEdge.length - 1; index >= 0; index -= 1) shape.lineTo(rightEdge[index].x, rightEdge[index].y);
  shape.closePath();
  return shape;
}

const logoUvGenerator: THREE.UVGenerator = {
  generateTopUV: (_geometry, vertices, indexA, indexB, indexC) => [indexA, indexB, indexC].map((index) => new THREE.Vector2(
    (vertices[index * 3] + 0.77) / 1.54,
    (vertices[index * 3 + 1] + 0.77) / 1.54,
  )),
  generateSideWallUV: () => [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1, 0),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(0, 1),
  ],
};

export function Logo3D({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container || !("WebGLRenderingContext" in window)) return;

    setReady(false);
    container.querySelector<HTMLElement>(".logo-3d-fallback")?.style.setProperty("opacity", "1");
    let frame = 0;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    let texture: THREE.Texture | undefined;
    let emblemGeometry: THREE.ExtrudeGeometry | undefined;
    let faceMaterial: THREE.MeshStandardMaterial | undefined;
    let edgeMaterial: THREE.MeshPhysicalMaterial | undefined;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    const startedAt = performance.now();
    const logo = new THREE.Group();
    const particles = new THREE.Group();

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.domElement.style.opacity = "0";
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      container.appendChild(renderer.domElement);
    } catch {
      return;
    }

      let revealFrame = 0;
    camera.position.set(0, 0.05, 4.3);
    scene.add(logo, particles);
    scene.add(new THREE.HemisphereLight(0xd8efff, 0x07152b, 0.8));

    const keyLight = new THREE.PointLight(0x8fdcff, 6, 8, 2);
    keyLight.position.set(2.4, 2.2, 3.2);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x377bd6, 4, 7, 2);
    rimLight.position.set(-2.5, -0.6, 2.4);
    scene.add(rimLight);

    const particleCount = 90;
    const positions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.3 + Math.random() * 1.05;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 2.6;
      positions[index * 3 + 2] = Math.sin(angle) * radius * 0.45;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0x7dd9ff, size: 0.026, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
    particles.add(new THREE.Points(particleGeometry, particleMaterial));

    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}viai-logodone.png`, (loaded) => {
      if (disposed) { loaded.dispose(); return; }
      texture = loaded;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.premultiplyAlpha = false;
      const shape = createLogoShape(loaded.image as HTMLImageElement);
      if (!shape) return;

      emblemGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.12,
        bevelEnabled: true,
        bevelSegments: 3,
        bevelSize: 0.018,
        bevelThickness: 0.018,
        curveSegments: 48,
        UVGenerator: logoUvGenerator,
      });
      emblemGeometry.translate(0, 0, -0.06);
      faceMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.01,
        side: THREE.DoubleSide,
        metalness: 0.16,
        roughness: 0.42,
      });
      edgeMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x07111d,
        metalness: 0.9,
        roughness: 0.24,
        clearcoat: 0.65,
        clearcoatRoughness: 0.16,
      });
      logo.add(new THREE.Mesh(emblemGeometry, [faceMaterial, edgeMaterial]));
      revealFrame = requestAnimationFrame(() => {
        if (disposed) return;
        renderer.domElement.style.opacity = "1";
        container.querySelector<HTMLElement>(".logo-3d-fallback")?.style.setProperty("opacity", "0");
        setReady(true);
      });
    });

    const resize = () => {
      const size = Math.max(1, Math.min(container.clientWidth, container.clientHeight));
      renderer.setSize(size, size, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let lastRenderAt = 0;
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (document.hidden || now - lastRenderAt < 33) return;
      lastRenderAt = now;
      const elapsed = (performance.now() - startedAt) / 1_000;
      logo.rotation.x = -0.08;
      logo.rotation.y = Math.sin(elapsed * 0.9 + 0.68) * 0.72;
      logo.position.y = Math.sin(elapsed * 1.05) * 0.09;
      particles.rotation.y = -elapsed * 0.14;
      particles.position.y = Math.cos(elapsed * 0.8) * 0.035;
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(revealFrame);
      observer.disconnect();
      texture?.dispose();
      emblemGeometry?.dispose();
      faceMaterial?.dispose();
      edgeMaterial?.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={`logo-3d ${ready ? "ready" : ""} ${className}`} aria-hidden="true"><img className="logo-3d-fallback" src={`${import.meta.env.BASE_URL}viai-logodone.png`} alt="" /></div>;
}