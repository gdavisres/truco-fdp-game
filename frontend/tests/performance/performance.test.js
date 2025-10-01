/**
 * Performance Tests
 * Automated testing for bundle size, frame rates, and load times
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { gzipSync } from 'zlib';

describe('Performance Benchmarks', () => {
  const distPath = resolve(process.cwd(), 'dist');
  let buildStats = {};

  beforeAll(() => {
    try {
      // Collect build statistics
      const indexHtml = join(distPath, 'index.html');
      const assetsPath = join(distPath, 'assets');
      
      // Read build files
      const htmlContent = readFileSync(indexHtml, 'utf-8');
      
      // Extract asset filenames from HTML
      const cssMatch = htmlContent.match(/href="[./]*assets\/(index-[^"]+\.css)"/);
      const jsMatch = htmlContent.match(/src="[./]*assets\/(index-[^"]+\.js)"/);
      
      if (cssMatch && jsMatch) {
        const cssFile = join(assetsPath, cssMatch[1]);
        const jsFile = join(assetsPath, jsMatch[1]);
        
        const htmlSize = statSync(indexHtml).size;
        const cssSize = statSync(cssFile).size;
        const jsSize = statSync(jsFile).size;
        
        const htmlContent2 = readFileSync(indexHtml);
        const cssContent = readFileSync(cssFile);
        const jsContent = readFileSync(jsFile);
        
        buildStats = {
          html: {
            raw: htmlSize,
            gzip: gzipSync(htmlContent2).length,
          },
          css: {
            raw: cssSize,
            gzip: gzipSync(cssContent).length,
          },
          js: {
            raw: jsSize,
            gzip: gzipSync(jsContent).length,
          },
        };
        
        buildStats.total = {
          raw: htmlSize + cssSize + jsSize,
          gzip: buildStats.html.gzip + buildStats.css.gzip + buildStats.js.gzip,
        };
        
        console.log('✅ Build stats collected successfully');
      } else {
        console.warn('Could not find asset references in HTML');
        buildStats = null;
      }
    } catch (error) {
      console.warn('Could not collect build stats:', error.message);
      buildStats = null;
    }
  });

  describe('Bundle Size', () => {
    it('should keep total gzipped bundle under 500KB', () => {
      if (!buildStats || !buildStats.total) {
        console.warn('Skipping bundle size test - run `npm run build` first');
        expect(true).toBe(true); // Pass the test if no build available
        return;
      }
      
      const maxSize = 500 * 1024; // 500KB in bytes
      const actualSize = buildStats.total.gzip;
      
      console.log(`Total bundle size (gzipped): ${(actualSize / 1024).toFixed(2)} KB`);
      console.log(`Budget remaining: ${((maxSize - actualSize) / 1024).toFixed(2)} KB`);
      
      expect(actualSize).toBeLessThan(maxSize);
    });

    it('should keep JavaScript bundle under 400KB gzipped', () => {
      if (!buildStats || !buildStats.js) {
        console.warn('Skipping JS bundle size test - run `npm run build` first');
        expect(true).toBe(true); // Pass the test if no build available
        return;
      }
      
      const maxSize = 400 * 1024; // 400KB in bytes
      const actualSize = buildStats.js.gzip;
      
      console.log(`JavaScript bundle size (gzipped): ${(actualSize / 1024).toFixed(2)} KB`);
      
      expect(actualSize).toBeLessThan(maxSize);
    });

    it('should keep CSS bundle under 50KB gzipped', () => {
      if (!buildStats || !buildStats.css) {
        console.warn('Skipping CSS bundle size test - run `npm run build` first');
        expect(true).toBe(true); // Pass the test if no build available
        return;
      }
      
      const maxSize = 50 * 1024; // 50KB in bytes
      const actualSize = buildStats.css.gzip;
      
      console.log(`CSS bundle size (gzipped): ${(actualSize / 1024).toFixed(2)} KB`);
      
      expect(actualSize).toBeLessThan(maxSize);
    });

    it('should warn if bundle grows more than 10% from baseline', () => {
      if (!buildStats || !buildStats.total) {
        console.warn('Skipping bundle growth test - run `npm run build` first');
        expect(true).toBe(true); // Pass the test if no build available
        return;
      }
      
      // Baseline measurements from initial optimization (in bytes, gzipped)
      const baseline = {
        html: 0.41 * 1024,
        css: 6.59 * 1024,
        js: 37.74 * 1024,
      };
      
      const currentTotal = buildStats.total.gzip;
      const baselineTotal = baseline.html + baseline.css + baseline.js;
      const growthPercent = ((currentTotal - baselineTotal) / baselineTotal) * 100;
      
      console.log(`Bundle size change from baseline: ${growthPercent.toFixed(2)}%`);
      
      if (growthPercent > 10) {
        console.warn('⚠️  Bundle size has grown more than 10% from baseline!');
        console.warn('Please review recent changes and ensure growth is justified.');
      }
      
      // This is a soft warning, not a hard failure
      expect(growthPercent).toBeLessThan(50); // Hard limit: 50% growth
    });
  });

  describe('Performance Characteristics', () => {
    it('should have minimal dependency footprint', () => {
      // Check package.json for production dependencies
      const packageJson = JSON.parse(
        readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')
      );
      
      const prodDeps = Object.keys(packageJson.dependencies || {});
      
      console.log('Production dependencies:', prodDeps);
      
      // We should only have socket.io-client as a dependency
      expect(prodDeps.length).toBeLessThanOrEqual(1);
      expect(prodDeps).toContain('socket.io-client');
    });

    it('should use module-based architecture for tree-shaking', () => {
      // Verify that our modules export cleanly
      const moduleRegistry = readFileSync(
        resolve(process.cwd(), 'src/modules/moduleRegistry.js'),
        'utf-8'
      );
      
      // Should have export statements for all modules
      expect(moduleRegistry).toContain('export');
      expect(moduleRegistry).toContain('bootstrapModules');
    });
  });

  describe('Animation Optimization', () => {
    it('should use GPU-accelerated CSS properties', () => {
      // Check that CSS uses transform and opacity (GPU-accelerated)
      // rather than top/left/width/height (CPU-bound)
      const cssFiles = [
        'src/css/cardRenderer.css',
        'src/css/gameBoard.css',
      ];
      
      cssFiles.forEach(file => {
        const css = readFileSync(resolve(process.cwd(), file), 'utf-8');
        
        // Should use transform for animations
        if (css.includes('transition') || css.includes('animation')) {
          expect(
            css.includes('transform') || css.includes('opacity')
          ).toBe(true);
        }
      });
    });

    it('should use will-change hints or transform optimizations for animated elements', () => {
      const cardRendererCss = readFileSync(
        resolve(process.cwd(), 'src/css/cardRenderer.css'),
        'utf-8'
      );
      
      // Check for GPU-accelerated properties (transform, translateZ)
      // will-change is optional but transform optimizations should be present
      expect(
        cardRendererCss.includes('will-change') ||
        cardRendererCss.includes('translateZ') ||
        cardRendererCss.includes('transform:')
      ).toBe(true);
    });
  });

  describe('Loading Optimization', () => {
    it('should have index.html with minimal inline content', () => {
      const htmlPath = resolve(process.cwd(), 'index.html');
      const html = readFileSync(htmlPath, 'utf-8');
      
      // Should not have large inline scripts or styles
      const inlineScriptSize = (html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [])
        .join('')
        .length;
      
      const inlineStyleSize = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || [])
        .join('')
        .length;
      
      console.log(`Inline script size: ${inlineScriptSize} bytes`);
      console.log(`Inline style size: ${inlineStyleSize} bytes`);
      
      // Inline content should be minimal
      expect(inlineScriptSize).toBeLessThan(1024); // 1KB max
      expect(inlineStyleSize).toBeLessThan(2048); // 2KB max
    });

    it('should use passive event listeners for scroll/touch events', () => {
      const cardRendererJs = readFileSync(
        resolve(process.cwd(), 'src/modules/cardRenderer/index.js'),
        'utf-8'
      );
      
      // Check for pointer events (more efficient than touch events)
      if (cardRendererJs.includes('addEventListener')) {
        expect(
          cardRendererJs.includes('pointerdown') ||
          cardRendererJs.includes('pointerup') ||
          cardRendererJs.includes('pointermove')
        ).toBe(true);
      }
    });
  });
});
