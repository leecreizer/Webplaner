// 라이트맵 굽기 시험(앱에 연결하지 않음) — Homvue 59C 거실을 LightBaker 로 굽고 WebGPU 캔버스에 우리 카메라로 그린다.
//   const poc = await import('/src/vendor/lightbaker/poc.js'); await poc.run({ scene, camera, room, toneMapping, exposure })
import * as THREE from 'three/webgpu';
import { LightBaker } from './lighting/LightBaker.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';

let state = null;
export const VERSION = 3;
export const getState = () => state;

export function stop() {
	if ( ! state ) return;
	state.renderer.setAnimationLoop( null );
	state.abort.abort();
	state.canvas.remove();
	state.renderer.dispose();
	state = null;
}

export async function run( { scene, camera, room, toneMapping = THREE.ACESFilmicToneMapping, exposure = 1, algorithm = 'stochastic', resolution = 2048, maxTris = 50000, onLog = console.log } ) {
	stop();
	const t0 = performance.now();
	const log = ( s ) => onLog( `${ ( ( performance.now() - t0 ) / 1000 ).toFixed( 1 ) }초 ${ s }` );

	// 굽기 전용 장면 — 거실에 걸치는 메시만 복제(재질도 복제해 원래 장면 재질은 그대로), 월드 행렬을 박아 둔다
	const bake = new THREE.Scene();
	bake.background = scene.background;
	bake.backgroundIntensity = scene.backgroundIntensity ?? 1;
	const box = new THREE.Box3();
	let meshes = 0, tris = 0, mapped = 0, mappedTris = 0;
	scene.updateMatrixWorld( true );
	scene.traverse( ( o ) => {
		if ( ! o.isMesh || o.isInstancedMesh || ! o.visible ) return;
		for ( let p = o.parent; p; p = p.parent ) if ( ! p.visible ) return;
		const m0 = Array.isArray( o.material ) ? o.material[ 0 ] : o.material;
		if ( ! m0 || m0.isMeshBasicMaterial || m0.isShaderMaterial || ! m0.isMeshStandardMaterial ) return;
		if ( o.userData.causticPatch ) return;
		box.setFromObject( o );
		if ( ! box.intersectsBox( room ) ) return;
		const c = new THREE.Mesh( o.geometry, Array.isArray( o.material ) ? o.material.map( ( m ) => m.clone() ) : o.material.clone() );
		c.matrixAutoUpdate = false;
		c.matrix.copy( o.matrixWorld );
		c.matrixWorld.copy( o.matrixWorld );
		c.castShadow = c.receiveShadow = true;
		c.name = o.name;
		const g = o.geometry;
		const n = ( g.index ? g.index.count : g.attributes.position.count ) / 3;
		// 삼각형이 많은 메시(커튼 222만·가방 50만 등)는 라이트맵을 만들지 않는다 — 그림자·가림에는 그대로 참여
		if ( n > maxTris ) c.userData.lightMapScale = 0;
		else { mapped ++; mappedTris += n; }
		bake.add( c );
		meshes ++;
		tris += n;
	} );
	// 조명 — 태양 + 거실 안 실내 조명(월드 위치·방향 그대로)
	const lights = { dir: 0, spot: 0, rect: 0 };
	scene.traverse( ( o ) => {
		if ( ! o.isLight || o.isAmbientLight || o.isHemisphereLight || ! o.visible && ! o.userData.rasterSkip ) return;
		const p = new THREE.Vector3().setFromMatrixPosition( o.matrixWorld );
		if ( ! o.isDirectionalLight && ! room.containsPoint( p ) ) return;
		let l;
		if ( o.isDirectionalLight ) { l = new THREE.DirectionalLight( o.color, o.intensity ); lights.dir ++; }
		else if ( o.isSpotLight ) { l = new THREE.SpotLight( o.color, o.intensity, o.distance, o.angle, o.penumbra, o.decay ); lights.spot ++; }
		else if ( o.isRectAreaLight ) { l = new THREE.RectAreaLight( o.color, o.intensity, o.width, o.height ); lights.rect ++; }
		else if ( o.isPointLight ) l = new THREE.PointLight( o.color, o.intensity, o.distance, o.decay );
		else return;
		o.matrixWorld.decompose( l.position, l.quaternion, l.scale );
		l.scale.set( 1, 1, 1 );
		if ( o.target ) { l.target.position.setFromMatrixPosition( o.target.matrixWorld ); bake.add( l.target ); }
		if ( l.shadow && ( o.isDirectionalLight || o.isSpotLight ) ) {
			l.castShadow = true;
			l.shadow.mapSize.set( 2048, 2048 );
			if ( o.isDirectionalLight ) {
				// 거실을 덮는 그림자 상자
				const s = l.shadow.camera; s.left = - 8; s.right = 8; s.top = 8; s.bottom = - 8; s.near = 0.5; s.far = 200;
				l.shadow.bias = - 0.0005;
			}
		}
		bake.add( l );
	} );
	log( `굽기 장면: 메시 ${ meshes } · 삼각형 ${ Math.round( tris / 1e4 ) / 100 }백만 · 라이트맵 대상 ${ mapped }개 ${ Math.round( mappedTris / 1e4 ) / 100 }백만 · 조명 ${ JSON.stringify( lights ) }` );

	// WebGPU 렌더러 — 화면 위에 겹친 캔버스(마우스는 아래 r3f 캔버스가 받아 우리 카메라가 그대로 움직인다)
	const host = document.querySelector( 'canvas' ).parentElement;
	const canvas = document.createElement( 'canvas' );
	canvas.id = 'lightbake-poc';
	canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:5;';
	host.appendChild( canvas );
	const adapter = await navigator.gpu?.requestAdapter();
	// 텍스처 한도 — 라이트맵에서 뺀 메시는 실내 조명 16개의 그림자 지도까지 읽어 18~20개가 돼 기본 16 을 넘었다(소파·가방이 안 그려짐)
	const requiredLimits = adapter ? { maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage, maxSampledTexturesPerShaderStage: adapter.limits.maxSampledTexturesPerShaderStage } : {};
	const renderer = new THREE.WebGPURenderer( { canvas, antialias: true, requiredLimits } );
	await renderer.init();
	THREE.RectAreaLightNode.setLTC( RectAreaLightTexturesLib.init() );
	renderer.shadowMap.enabled = true;
	renderer.toneMapping = toneMapping;
	renderer.toneMappingExposure = exposure;
	const resize = () => {
		renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) );
		renderer.setSize( host.clientWidth, host.clientHeight, false );
	};
	resize();
	const abort = new AbortController();
	state = { renderer, canvas, abort, bake, log };
	log( 'WebGPU 렌더러 준비' );

	const baker = new LightBaker( renderer, { algorithm, resolution, unwrap: 'repack', directLight: 'baked', denoise: true, stitchSeams: true } );
	state.baker = baker;
	const tp = performance.now();
	await baker.prepare( bake );
	log( `준비 끝(UV 다시 배치·광원 설정) ${ ( ( performance.now() - tp ) / 1000 ).toFixed( 1 ) }초 · 라이트맵 ${ baker.atlasResolution ?? resolution }px · 장 ${ baker.lightMapper?.pages?.length }` );
	baker.apply();
	renderer.setAnimationLoop( () => {
		if ( host.clientWidth !== canvas.clientWidth || host.clientHeight !== canvas.clientHeight ) resize();
		camera.updateMatrixWorld();
		renderer.render( bake, camera );
	} );
	const tb = performance.now();
	let lastLog = 0;
	await baker.bake( bake, {
		signal: abort.signal,
		onProgress: ( { samples, noise } ) => {
			if ( performance.now() - lastLog > 3000 ) { lastLog = performance.now(); log( `굽는 중 샘플 ${ samples } · 노이즈 ${ ( noise * 100 ).toFixed( 1 ) }%` ); }
		},
	} );
	log( `굽기 끝 — ${ ( ( performance.now() - tb ) / 1000 ).toFixed( 1 ) }초 · 샘플 ${ baker.samples } · 노이즈 ${ ( baker.noise * 100 ).toFixed( 1 ) }%` );
	// 스포트 그림자 끄기 — 라이트맵에서 뺀 메시(소파·커튼)는 조명마다 그림자 지도를 읽어 셰이더 샘플러가 16개를 넘었다(그래픽 카드 최대 16).
	// 스포트 직접광은 이미 라이트맵에 구워졌다(directLight: 'baked') — 빠진 메시만 그림자 없는 스포트를 받는다
	bake.traverse( ( o ) => { if ( o.isSpotLight ) o.castShadow = false; } );
	log( `표시 한도 — 텍스처 ${ renderer.backend.device?.limits?.maxSampledTexturesPerShaderStage } · 샘플러 ${ renderer.backend.device?.limits?.maxSamplersPerShaderStage }` );
	return state;
}
