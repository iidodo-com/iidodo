// 全シェーダで共有する時間 uniform と、風で揺れるマテリアルのヘルパー
export const TIME = { value: 0 };

/** MeshStandard/Lambert に風揺れ (頂点シェーダ) を注入。heightStart より上の頂点ほど大きく揺れる。 */
export function addWind(material, { strength = 0.1, heightStart = 0, fade = 0, nearFade = 0 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uTime = TIME;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
      #else
        vec3 ip = vec3(0.0);
      #endif
      float wv = sin(uTime * 1.7 + ip.x * 0.31 + ip.z * 0.23) + 0.5 * sin(uTime * 3.3 + ip.x * 0.8 - ip.z * 0.6);
      float hh = max(position.y - ${heightStart.toFixed(2)}, 0.0);
      transformed.x += wv * ${strength.toFixed(3)} * hh * hh;
      transformed.z += wv * ${(strength * 0.5).toFixed(3)} * hh * hh;
    `);
    if (nearFade > 0) {
      // カメラに近い葉をディザで消し、手前の木が視界を塞がないようにする
      shader.uniforms.uNear = { value: nearFade };
      shader.fragmentShader = 'uniform float uNear;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        {
          float dn = length(vViewPosition);
          float fn = 1.0 - smoothstep(uNear * 0.45, uNear, dn);
          float hn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (fn > hn) discard;
        }
      `);
    }
    if (fade > 0) {
      // 遠距離でディザ消去 (ポップイン対策)
      shader.uniforms.uFar = { value: fade };
      shader.fragmentShader = 'uniform float uFar;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        {
          float dd = length(vViewPosition);
          float f = smoothstep(uFar * 0.55, uFar, dd);
          float hsh = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (f > hsh) discard;
        }
      `);
    }
  };
}
