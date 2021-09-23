export interface InstalledPluginInfo extends Extension {
  installedVersion: string | null
  installationInProgress?: true
}


// TODO: Remove type duplication in extensions.paneron.org codebase
// Separate into a package?
export interface Extension extends PaneronExtensionMeta {
  author: string
  description: string
  latestUpdate: Date
  websiteURL?: string
  npm: Pick<NPMPackageVersion, 'name' | 'version' | 'bugs' | 'dist'>
}


/* Lives under a custom subkey of package.json */
export interface PaneronExtensionMeta {
  title: string
  iconURL: string
  featured: boolean
  requiredHostAppVersion: string
}


export interface NPMPackageVersion {
  name: string
  version: string
  description: string
  author: {
    email: string
    name: string
  }
  _npmUser: {
    email: string
    name: string
  }
  bugs?: {
    url: string
  }
  dist?: {
    integrity: string
    "npm-signature": string
    shasum: string
    unpackedSize: number
  }
}
