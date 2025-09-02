import type { InputSchema, InternalRoute, TSchema } from 'elysia'
import {
	readFileSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	existsSync,
	cpSync,
	exists
} from 'fs'
import { TypeBox } from '@sinclair/typemap'

import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { AdditionalReference, AdditionalReferences } from '../types'
import { Kind, TObject } from '@sinclair/typebox/type'

const matchRoute = /: Elysia<(.*)>/gs
const matchStatus = /(\d{3}):/gs
const wrapStatusInQuote = (value: string) => value.replace(matchStatus, '"$1":')

const exec = (command: string, cwd: string) =>
	spawnSync(command, {
		shell: true,
		cwd,
		stdio: 'inherit'
	})

interface OpenAPIGeneratorOptions {
	/**
	 * Path to tsconfig.json
	 * @default tsconfig.json
	 */
	tsconfigPath?: string

	/**
	 * Name of the Elysia instance
	 *
	 * If multiple instances are found,
	 * instanceName should be provided
	 */
	instanceName?: string

	/**
	 * Project root directory
	 *
	 * @default process.cwd()
	 */
	projectRoot?: string

	/**
	 * Override output path
	 *
	 * Under any circumstance, that Elysia failed to find a correct schema,
	 * Put your own schema in this path
	 */
	overrideOutputPath?(tempDir: string): string
}

/**
 * Auto generate OpenAPI schema from Elysia instance
 *
 * It's expected that this command should run in project root
 *
 * @experimental use at your own risk
 */
export const fromTypes =
	(
		/**
		 * Path to file where Elysia instance is
		 *
		 * The path must export an Elysia instance
		 */
		targetFilePath: string,
		{
			tsconfigPath = 'tsconfig.json',
			instanceName,
			projectRoot = process.cwd(),
			overrideOutputPath
		}: OpenAPIGeneratorOptions = {}
	) =>
	() => {
		if (!targetFilePath.endsWith('.ts') && !targetFilePath.endsWith('.tsx'))
			throw new Error('Only .ts files are supported')

		const tmpRoot = join(tmpdir(), '.ElysiaAutoOpenAPI')

		if (existsSync(tmpRoot))
			rmSync(tmpRoot, { recursive: true, force: true })
		mkdirSync(tmpRoot, { recursive: true })

		const extendsRef = existsSync(join(projectRoot, 'tsconfig.json'))
			? `"extends": "${join(projectRoot, 'tsconfig.json')}",`
			: ''

		if (!join(projectRoot, targetFilePath))
			throw new Error('Target file does not exist')

		writeFileSync(
			join(tmpRoot, tsconfigPath),
			`{
			${extendsRef}
			"compilerOptions": {
				"lib": ["ESNext"],
				"module": "ESNext",
				"noEmit": false,
				"declaration": true,
				"emitDeclarationOnly": true,
				"moduleResolution": "bundler",
				"skipLibCheck": true,
				"skipDefaultLibCheck": true,
				"outDir": "./dist"
			},
			"include": ["${join(projectRoot, targetFilePath)}"]
		}`
		)

		exec(`tsc`, tmpRoot)

		try {
			const fileName = targetFilePath
				.replace(/.tsx$/, '.ts')
				.replace(/.ts$/, '.d.ts')

			let targetFile =
				overrideOutputPath?.(tmpRoot) ?? join(tmpRoot, 'dist', fileName)

			{
				const _targetFile = join(
					tmpRoot,
					'dist',
					fileName.slice(fileName.indexOf('/') + 1)
				)

				if (existsSync(_targetFile)) targetFile = _targetFile
			}

			const declaration = readFileSync(targetFile, 'utf8')

			// Check just in case of race-condition
			if (existsSync(tmpRoot))
				rmSync(tmpRoot, { recursive: true, force: true })

			let instance = declaration.match(
				instanceName
					? new RegExp(`${instanceName}: Elysia<(.*)`, 'gs')
					: matchRoute
			)?.[0]

			if (!instance) return

			// Get 5th generic parameter
			// Elysia<'', {}, {}, {}, Routes>
			// ------------------------^
			//         1   2   3   4   5
			// We want the 4th one
			for (let i = 0; i < 3; i++)
				instance = instance.slice(instance.indexOf('}, {', 3))

			const routesString =
				wrapStatusInQuote(instance).slice(
					3,
					instance.indexOf('}, {', 3)
				) + '}\n}\n'

			const routes: AdditionalReference = {}

			// Treaty is a collection of { ... } & { ... } & { ... }
			// Each route will be intersected with each other
			// instead of being nested in a route object
			for (const route of routesString.slice(1).split('} & {')) {
				// as '} & {' is removed, we need to add it back
				let schema = TypeBox(`{${route}}}`)
				if (schema.type !== 'object') {
					// just in case
					schema = TypeBox(`{${route}}`)

					if (schema.type !== 'object') continue
				}

				const paths = []

				while (true) {
					const keys = Object.keys(schema.properties)
					if (keys.length !== 1) break

					paths.push(keys[0])

					schema = schema.properties[keys[0]] as any
					if (!schema?.properties) break
				}

				const method = paths.pop()!
				const path = '/' + paths.join('/')
				schema = schema.properties

				if (schema?.response?.type === 'object') {
					const responseSchema: Record<string, any> = {}

					for (const key in schema.response.properties)
						responseSchema[key] = schema.response.properties[key]

					schema.response = responseSchema
				}

				if (!routes[path]) routes[path] = {}
				// @ts-ignore
				routes[path][method.toLowerCase()] = schema
			}

			return routes
		} catch (error) {
			console.warn(
				'[@elysiajs/openapi/gen] Failed to generate OpenAPI schema'
			)
			console.warn(error)

			return
		}
	}
