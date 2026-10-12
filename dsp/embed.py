# writes dsp_wasm.js: the compiled Rust DSP as base64, for the single-file build
import base64
import os
HERE = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(HERE, 'tactus_dsp.wasm'),'rb').read()
open(os.path.join(HERE, '..', 'src', 'js', 'dsp_wasm.js'),'w').write('// Tactus DSP (Rust → WebAssembly, source in dsp/src/lib.rs), %d bytes\nconst DSP_WASM_B64 = "%s";\n' % (len(b), base64.b64encode(b).decode()))
print(len(b), 'bytes')
