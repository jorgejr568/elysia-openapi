import { Elysia, type InternalRoute } from 'elysia'

import { SwaggerUIRender } from './swagger'
import { ScalarRender } from './scalar'

import { toOpenAPISchema } from './openapi'

import type { OpenAPIV3 } from 'openapi-types'
import type { ReferenceConfiguration } from '@scalar/types'
import type { ElysiaOpenAPIConfig, OpenAPIProvider } from './types'

/**
 * Plugin for [elysia](https://github.com/elysiajs/elysia) that auto-generate Swagger page.
 *
 * @see https://github.com/elysiajs/elysia-swagger
 */
export const openapi = <
	const Path extends string = '/openapi',
	const Provider extends OpenAPIProvider = 'scalar'
>({
	provider = 'scalar',
	path = '/openapi' as Path,
	specPath = `${path}/json`,
	documentation = {},
	exclude,
	swagger,
	scalar
}: ElysiaOpenAPIConfig<Path, Provider> = {}) => {
	const {
		version: swaggerVersion = '5.9.0',
		theme: swaggerTheme = `https://unpkg.com/swagger-ui-dist@${swaggerVersion}/swagger-ui.css`,
		autoDarkMode = true,
		...swaggerOptions
	} = swagger ?? {}

	const {
		version: scalarVersion = 'latest',
		cdn: scalarCDN = '',
		...scalarConfig
	} = scalar ?? {}

	const info = {
		title: 'Elysia Documentation',
		description: 'Development documentation',
		version: '0.0.0',
		...documentation.info
	}

	const relativePath = specPath.startsWith('/') ? specPath.slice(1) : specPath

	let totalRoutes = 0
	let cachedSchema: OpenAPIV3.Document | undefined

	const app = new Elysia({ name: '@elysiajs/swagger' })
		.use((app) => {
			if (provider === null) return app

			return app.get(
				path,
				new Response(
					provider === 'swagger-ui'
						? SwaggerUIRender(
								info,
								swaggerVersion,
								swaggerTheme,
								JSON.stringify(
									{
										url: relativePath,
										dom_id: '#swagger-ui',
										...swaggerOptions
									},
									(_, value) =>
										typeof value === 'function'
											? undefined
											: value
								),
								autoDarkMode
							)
						: ScalarRender(
								info,
								scalarVersion,
								{
									spec: {
										url: relativePath,
										...scalarConfig.spec
									},
									...scalarConfig,
									// so we can showcase the elysia theme
									// @ts-expect-error
									_integration: 'elysiajs'
								} satisfies ReferenceConfiguration,
								scalarCDN
							),
					{
						headers: {
							'content-type': 'text/html; charset=utf8'
						}
					}
				),
				{
					detail: {
						hide: true
					}
				}
			)
		})
		.get(
			specPath,
			function openAPISchema() {
				if (totalRoutes === app.routes.length) return cachedSchema

				totalRoutes = app.routes.length

				const {
					paths,
					components: { schemas }
				} = toOpenAPISchema(app, exclude)

				return (cachedSchema = {
					openapi: '3.0.3',
					...documentation,
					tags: !exclude?.tags
						? documentation.tags
						: documentation.tags?.filter(
								(tag) => !exclude.tags?.includes(tag.name)
							),
					info: {
						title: 'Elysia Documentation',
						description: 'Development documentation',
						version: '0.0.0',
						...documentation.info
					},
					paths: {
						...paths,
						...documentation.paths
					},
					components: {
						...documentation.components,
						schemas: {
							...schemas,
							...documentation.components?.schemas
						}
					}
				} satisfies OpenAPIV3.Document)
			},
			{
				detail: {
					hide: true
				}
			}
		)

	return app
}

export { toOpenAPISchema, withHeaders } from './openapi'
export type { ElysiaOpenAPIConfig }
export default openapi
