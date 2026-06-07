import { login } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const resolvedParams = await searchParams

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4">
      <form className="flex flex-col gap-4 w-full max-w-sm p-6 bg-white rounded shadow-md">
        <h1 className="text-xl font-bold text-gray-900 mb-2">運送業務管理システム</h1>
        <div>
          <label className="block text-sm font-medium text-gray-700">メールアドレス</label>
          <input
            name="email"
            type="email"
            required
            className="mt-1 block w-full rounded border border-gray-300 p-2 text-black"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">パスワード</label>
          <input
            name="password"
            type="password"
            required
            className="mt-1 block w-full rounded border border-gray-300 p-2 text-black"
          />
        </div>
        <button formAction={login} className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 transition">
          ログイン
        </button>
        {resolvedParams.error && (
          <p className="text-red-500 text-sm mt-2 text-center">{resolvedParams.error}</p>
        )}
      </form>
    </div>
  )
}
