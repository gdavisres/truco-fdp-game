const moduleRegistry = [];

export const registerModule = (loader) => {
  if (typeof loader !== 'function') {
    throw new TypeError('Module loader must be a function that returns a Promise.');
  }

  moduleRegistry.push(loader);
};

export const clearModules = () => {
  moduleRegistry.splice(0, moduleRegistry.length);
};

export const bootstrapModules = async (context, onModuleError) => {
  for (const loader of moduleRegistry) {
    try {
      const module = await loader();
      if (typeof module?.init === 'function') {
        await module.init(context);
      }
    } catch (error) {
      if (onModuleError) {
        onModuleError(error, loader.name || 'anonymous-loader');
      }
    }
  }
};
