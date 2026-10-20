// n8ao ships JavaScript only: what Island uses of its pmndrs/postprocessing pass.
declare module "n8ao" {
  import type { Camera, Color, Scene } from "three";
  import { Pass } from "postprocessing";
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: { aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean; color: Color; gammaCorrection: boolean };
  }
}
