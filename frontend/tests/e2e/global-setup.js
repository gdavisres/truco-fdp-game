import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalSetup() {
  // Clear backend state before running tests
  const stateFilePath = path.join(__dirname, '..', '..', '..', 'backend', 'var', 'state.json');
  
  try {
    if (fs.existsSync(stateFilePath)) {
      fs.unlinkSync(stateFilePath);
      console.log('✓ Cleared backend state file');
    }
  } catch (error) {
    console.warn('⚠ Could not clear state file:', error.message);
  }
}
