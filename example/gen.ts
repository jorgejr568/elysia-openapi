import { Elysia, t } from 'elysia'
import { openapi } from '../src/index'
import { fromTypes } from '../src/gen'

export const app = new Elysia()
	.use(
		openapi({
			references: fromTypes('example/gen.ts')
		})
	)
	.get('/', { test: 'hello' as const })
	.post(
		'/json',
		({ body, status }) => (Math.random() > 0.5 ? status(418) : body),
		{
			body: t.Object({
				hello: t.String()
			})
		}
	)
	.get('/id/:id/name/:name', ({ params }) => params)
	.listen(3000)
